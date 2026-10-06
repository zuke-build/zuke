// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link dockerComposeCanary} — a Compose project as a platform for a
 * `@zuke/canary` rollout.
 *
 * ```ts
 * import { canary } from "@zuke/canary";
 * import { dockerComposeCanary } from "@zuke/docker-compose";
 *
 * rollout = canary((c) =>
 *   c.platform(dockerComposeCanary((d) =>
 *     d.service("app").canaryService("app-canary").replicas(4)
 *       .image(this.image.value)
 *       .stableImageVariable("APP_IMAGE")
 *       .canaryImageVariable("APP_CANARY_IMAGE")
 *   ))
 *     .steps(25, 50)
 *     .bake("10m")
 * );
 * ```
 *
 * The project runs the release as two services — a **stable** one and a
 * **canary** one — behind a proxy that balances requests across every
 * container of both. Exposure is the canary's share of a fixed total of
 * replicas, so it is quantised: with four replicas a canary is at 25, 50 or
 * 75 %, and {@link DockerComposeCanary.expose} returns the share it reached.
 *
 * Compose has no command that sets a service's image, so each service's
 * `image:` must be a whole variable — `image: ${APP_IMAGE}` — and the platform
 * sets that variable on the commands it runs, then checks with `ps` that the
 * service it moved runs the image it meant. That is an override for the one
 * command, not a change to the project: see
 * {@link DockerComposeCanary.promote} for what that means for a promotion.
 *
 * The canary engine's platform interface lives in `@zuke/canary`, and a wrapper
 * depends only on `@zuke/core`, so this module does not import it: the object
 * {@link dockerComposeCanary} returns has the same shape and is accepted by
 * `c.platform(...)` as it is.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { Configure } from "@zuke/core/tooling";
import {
  CALLER,
  CANARY_REPLICAS,
  canaryReplicas,
  candidateOf,
  handRunRollback,
  imageOf,
  recordedRollout,
  recordOf,
  type Rollback,
  type Rollout,
  STAGE,
  topologyOf,
  type Variables,
  variablesOf,
} from "./canary_plan.ts";
import {
  type DockerComposeCanaryContext,
  DockerComposeCanarySettings,
} from "./canary_settings.ts";
import { DockerComposePsSettings } from "./containers.ts";
import { DockerComposePullSettings } from "./images.ts";
import { DockerComposeUpSettings } from "./lifecycle.ts";
import { DockerComposeSettings } from "./settings.ts";

/** The Go template `compose ps` renders one container's image with. */
const IMAGE_TEMPLATE = "{{.Image}}";

/**
 * The subcommand a {@link TrailingArgsProbe} renders: anything the global
 * lambda appends lands after it.
 */
const PROBE_TAIL = "<subcommand>";

/**
 * A command with only {@link PROBE_TAIL} for a subcommand, which the global
 * lambda is applied to so trailing `.args(...)` — which would follow the
 * service operand of every real command — can be told from global flags.
 */
class TrailingArgsProbe extends DockerComposeSettings {
  /** The placeholder subcommand. */
  protected override composeArgs(): string[] {
    return [PROBE_TAIL];
  }
}

/**
 * A Compose project as a canary platform. Create one with
 * {@link dockerComposeCanary}; hand it to `@zuke/canary`'s `c.platform(...)`.
 *
 * Exposure is the canary's share of the replicas, so it is quantised.
 */
export class DockerComposeCanary {
  /** Compose runs replicas, so exposure is a share of instances. */
  readonly exposure: "replicas" = "replicas";
  readonly #configure: Configure<DockerComposeCanarySettings>;

  /** A platform whose settings `configure` produces, afresh on every call. */
  constructor(configure: Configure<DockerComposeCanarySettings>) {
    this.#configure = configure;
  }

  /** `"Compose service app"`, for the build summary. */
  describe(): string {
    const service = this.#configure(new DockerComposeCanarySettings()).service_;
    return service === undefined
      ? "Compose service"
      : `Compose service ${service}`;
  }

  /**
   * Read the image the stable replicas run, make sure the candidate image is
   * available (pulled unless it is already present), record the rollout — the
   * two services, the replicas, the two variables and the two images, which
   * every later call acts on whatever the lambda says then — and bring the
   * project to exactly 0 %: the stable service at every replica, the canary
   * service at none. The stable replicas are only added or removed, never
   * recreated.
   */
  async stage(ctx: DockerComposeCanaryContext): Promise<void> {
    // First, before anything can throw: a stage that fails from here on is
    // rolled back with this record, which says nothing has changed yet. With
    // none, the rollback would take the hand-run path and recreate the stable
    // service on d.stable(...).
    await ctx.state.set({ [STAGE]: "deploying" });
    const settings = this.#settings();
    const topology = topologyOf(settings);
    const candidate = candidateOf(settings);
    const vars = variablesOf(settings);
    // Compose loads the whole file for any command, so the stable variable
    // must resolve too. Neither the read nor the pull touches the stable
    // containers, and `ps` reports the image they actually run, so the
    // candidate stands in until the stable image is known.
    const read = imageEnv(vars, candidate, candidate);
    const stableImage = await this.#servingImage(
      settings,
      topology.stable,
      read,
    );
    await this.#run(
      settings,
      new DockerComposePullSettings().policy("missing")
        .services(topology.canary),
      read,
    );
    const rollout: Rollout = { ...topology, ...vars, candidate, stableImage };
    // A rollback reads this to know what to return the stable service to, so
    // it must be on record before anything changes.
    if (
      !await ctx.state.trySet({ [STAGE]: "staged", ...recordOf(rollout) })
    ) {
      throw new Error(
        `${CALLER}: could not record the stable image, so a rollback could ` +
          "not return to it. Stopping before anything changes.",
      );
    }
    const env = imageEnv(vars, stableImage, candidate);
    await this.#scale(settings, topology.stable, topology.replicas, env, true);
    await this.#scale(settings, topology.canary, 0, env, false);
    ctx.reportSummary({ Candidate: candidate, Stable: stableImage });
  }

  /**
   * Run the canary service at `percent` of the replicas and the stable
   * service at the rest, and return the share actually reached. Any share
   * between 0 and 100 exclusive keeps at least one replica on each side, so a
   * step never rounds to an untested 0 % or a premature 100 %. Whichever
   * service grows is scaled first, so the total never dips below the
   * replicas. Once the canary service has replicas, `ps` must show every one
   * of them on the candidate — a canary whose `image:` does not read its
   * variable is refused rather than analysed. The stable replicas are never
   * recreated. The services and replicas are the ones `stage` recorded.
   */
  async expose(
    percent: number,
    ctx: DockerComposeCanaryContext,
  ): Promise<number> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error(
        `${CALLER}: an exposure is a share from 0 to 100, so it cannot be ` +
          `${percent} %.`,
      );
    }
    const settings = this.#settings();
    const state = ctx.state.get();
    const rollout = staged(recordedRollout(state));
    const env = imageEnv(rollout, rollout.stableImage, rollout.candidate);
    const canary = canaryReplicas(percent, rollout.replicas);
    const previous = state[CANARY_REPLICAS];
    const grow = async () => {
      await this.#scale(settings, rollout.canary, canary, env, false);
      if (canary > 0) {
        await this.#requireImage(
          settings,
          rollout.canary,
          rollout.candidate,
          rollout.canaryVariable,
          env,
        );
      }
    };
    const shrink = () =>
      this.#scale(
        settings,
        rollout.stable,
        rollout.replicas - canary,
        env,
        true,
      );
    if (typeof previous !== "number" || canary >= previous) {
      await grow();
      await shrink();
    } else {
      await shrink();
      await grow();
    }
    await ctx.state.set({ [CANARY_REPLICAS]: canary });
    return Math.round(canary * 10000 / rollout.replicas) / 100;
  }

  /**
   * Hand the stable service to the candidate: the canary service goes to
   * every replica, the stable service is recreated on the candidate image
   * with the stable variable set to it, `ps` must then show every stable
   * replica on the candidate — or the call refuses, before it is recorded as
   * promoted, since a stable `image:` that does not read the variable would
   * have changed nothing — and the canary service goes back to none. The
   * total never dips below the replicas; for a moment it is twice that.
   * Idempotent.
   *
   * **This is not durable on its own.** Compose has no state of its own to
   * change: the variable is set for these commands only. Until the
   * candidate is written where the stable variable comes from — the `.env`
   * file, or the environment of whatever runs `docker compose up` next — a
   * plain `docker compose up` puts the stable service back on the image that
   * source still names, and at the replica count its `scale:` names, which
   * is why that must equal {@link DockerComposeCanarySettings.replicas}. The
   * build summary says so: `Persist: set APP_IMAGE=<candidate> and keep
   * scale: <replicas>`.
   */
  async promote(ctx: DockerComposeCanaryContext): Promise<void> {
    const state = ctx.state.get();
    if (state[STAGE] === "promoted") return;
    const settings = this.#settings();
    const rollout = staged(recordedRollout(state));
    const env = imageEnv(rollout, rollout.candidate, rollout.candidate);
    await ctx.state.set({ [STAGE]: "promoting" });
    await this.#scale(
      settings,
      rollout.canary,
      rollout.replicas,
      env,
      false,
    );
    await this.#scale(
      settings,
      rollout.stable,
      rollout.replicas,
      env,
      false,
    );
    await this.#requireImage(
      settings,
      rollout.stable,
      rollout.candidate,
      rollout.stableVariable,
      env,
    );
    await this.#scale(settings, rollout.canary, 0, env, false);
    await ctx.state.set({ [STAGE]: "promoted" });
    ctx.reportSummary(persist(rollout, rollout.candidate));
  }

  /**
   * Put every replica back on the stable image, in the stable service, with
   * the canary service at none. Idempotent. Which image, services and
   * replicas depends on what this rollout recorded:
   *
   * - **`stage` recorded them** (a rollback mid-rollout, or after a
   *   promotion that failed part-way): the ones `stage` saw, whatever the
   *   lambda says now.
   * - **`stage` failed before recording them**: nothing had changed, so
   *   nothing runs — and the settings are not even read.
   * - **Nothing recorded** (`rollout.abort` run by hand, a fresh run): the
   *   settings, with the image set by
   *   {@link DockerComposeCanarySettings.stable}. Without one this refuses,
   *   since claiming a rollback it cannot do would be worse.
   *
   * `ps` first reads what the stable replicas run. When every one already
   * runs the stable image — mid-rollout, they do — the stable service is only
   * scaled back to every replica (`--no-recreate`). Otherwise — after a
   * promotion, run by hand or part-way — the stable replicas must be
   * recreated, which Compose does to all of them at once, so the rollback
   * mirrors a promotion: the canary service first goes to every replica on
   * the stable image, then the stable service is recreated on it, then the
   * canary service goes to none. Capacity never dips.
   *
   * Like a promotion, the image is an override for these commands, so it
   * lasts until a plain `docker compose up` reads the variable from wherever
   * the project keeps it. A hand-run rollback — the one that undoes a
   * promotion someone persisted — says so in the build summary, as promote
   * does: `Persist: set APP_IMAGE=<stable> and keep scale: <replicas>`.
   */
  async abort(ctx: DockerComposeCanaryContext): Promise<void> {
    const state = ctx.state.get();
    if (state[STAGE] === "deploying") return;
    const settings = this.#settings();
    const recorded = recordedRollout(state);
    const rollback: Rollback = recorded ?? handRunRollback(settings);
    const image = rollback.stableImage;
    // The canary service only ever runs the stable image here — a surge while
    // the stable replicas are recreated — so its variable names that too.
    const env = imageEnv(rollback, image, image);
    const running = await this.#runningImages(settings, rollback.stable, env);
    if (running.every((each) => each === image)) {
      await this.#scale(
        settings,
        rollback.stable,
        rollback.replicas,
        env,
        true,
      );
    } else {
      await this.#scale(
        settings,
        rollback.canary,
        rollback.replicas,
        env,
        false,
      );
      await this.#scale(
        settings,
        rollback.stable,
        rollback.replicas,
        env,
        false,
      );
    }
    await this.#scale(settings, rollback.canary, 0, env, false);
    if (recorded === undefined) ctx.reportSummary(persist(rollback, image));
  }

  /** The settings, evaluated now so the lambda sees resolved parameters. */
  #settings(): DockerComposeCanarySettings {
    return this.#configure(new DockerComposeCanarySettings());
  }

  /**
   * `up -d --no-deps --scale <service>=<count> <service>`, waiting for the
   * replicas when there are any. With `keep`, replicas that already exist
   * are not recreated (`--no-recreate`), so only the count changes.
   */
  #scale(
    settings: DockerComposeCanarySettings,
    service: string,
    count: number,
    env: Record<string, string>,
    keep: boolean,
  ): Promise<CommandOutput> {
    const up = new DockerComposeUpSettings().detach().noDeps();
    if (count > 0) up.wait();
    if (keep) up.noRecreate();
    return this.#run(settings, up.scale(service, count).services(service), env);
  }

  /** The one image the stable service's running replicas use. */
  async #servingImage(
    settings: DockerComposeCanarySettings,
    service: string,
    env: Record<string, string>,
  ): Promise<string> {
    const [image, ...others] = new Set(
      await this.#runningImages(settings, service, env),
    );
    if (image === undefined) {
      throw new Error(
        `${CALLER}: the service ${service} has no running replicas, so there ` +
          "is no stable release to compare a canary with or to roll back " +
          "to. Bring it up first.",
      );
    }
    if (others.length > 0) {
      throw new Error(
        `${CALLER}: the replicas of ${service} run different images ` +
          `(${[image, ...others].join(", ")}), so there is no one stable ` +
          "image to roll back to. Bring them onto one first.",
      );
    }
    return image;
  }

  /**
   * Refuse unless `service` has running replicas and every one runs `image`
   * — what the platform just asked for by setting `variable`.
   */
  async #requireImage(
    settings: DockerComposeCanarySettings,
    service: string,
    image: string,
    variable: string,
    env: Record<string, string>,
  ): Promise<void> {
    const running = await this.#runningImages(settings, service, env);
    if (running.length === 0 || running.some((each) => each !== image)) {
      throw new Error(
        `${CALLER}: the service ${service} runs ` +
          `${running.length === 0 ? "nothing" : running.join(", ")} after ` +
          `the platform set ${variable} to ${image}, so its image: does not ` +
          `read that variable. Make it image: \${${variable}}.`,
      );
    }
  }

  /**
   * The image of each running replica of `service`, as
   * `ps --format {{.Image}}` prints them. A truncated capture is refused:
   * capture keeps the newest bytes, so the first line may begin mid-image.
   */
  async #runningImages(
    settings: DockerComposeCanarySettings,
    service: string,
    env: Record<string, string>,
  ): Promise<string[]> {
    const ps = new DockerComposePsSettings().format(IMAGE_TEMPLATE)
      .services(service).quiet();
    const output = await this.#run(settings, ps, env);
    if (output.truncated) {
      throw new Error(
        `${CALLER}: compose printed more than the ` +
          `${output.maxCapturedBytes}-byte capture cap kept listing the ` +
          `images of ${service}, and capture drops the oldest bytes — raise ` +
          "it with d.compose((s) => s.maxCapturedBytes(bytes)).",
      );
    }
    return output.stdout.split("\n").map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => imageOf(line, `an image ps reported for ${service}`));
  }

  /**
   * Run `command` with the caller's global flags, then the image variables —
   * applied last, so a global `.env(...)` cannot override them — and refuse a
   * non-zero exit even when the global flags said not to throw.
   */
  async #run(
    settings: DockerComposeCanarySettings,
    command: DockerComposeSettings,
    env: Record<string, string>,
  ): Promise<CommandOutput> {
    const global = settings.compose_;
    if (global !== undefined) {
      const probe = global(new TrailingArgsProbe()).argv();
      if (probe.at(-1) !== PROBE_TAIL) {
        throw new Error(
          `${CALLER}: d.compose(...) adds trailing arguments ` +
            `(${
              probe.slice(probe.indexOf(PROBE_TAIL) + 1).join(" ")
            }), which ` +
            "would follow the service every command names. Use the typed " +
            "global flags instead.",
        );
      }
      global(command);
    }
    command.env(env);
    const output = await settings.runner_(command, env);
    if (output.code !== 0) {
      const stderr = output.stderr.trim();
      throw new Error(
        `${CALLER}: compose exited ${output.code} running ` +
          `${command.argv().join(" ")}${stderr === "" ? "." : `: ${stderr}`}`,
      );
    }
    return output;
  }
}

/** The two image variables set to `stable` and `canary`. */
function imageEnv(
  vars: Variables,
  stable: string,
  canary: string,
): Record<string, string> {
  return { [vars.canaryVariable]: canary, [vars.stableVariable]: stable };
}

/**
 * The build-summary pair telling the operator what to write down: the image
 * is an override for the platform's own commands, so it lasts only until a
 * plain `docker compose up` reads the variable — and the `scale:` — from the
 * project.
 */
function persist(
  rollback: Rollback,
  image: string,
): { Persist: string } {
  return {
    Persist: `set ${rollback.stableVariable}=${image} and keep scale: ` +
      `${rollback.replicas}`,
  };
}

/** The recorded rollout, or a refusal: expose and promote need a stage. */
function staged(rollout: Rollout | undefined): Rollout {
  if (rollout === undefined) {
    throw new Error(
      `${CALLER}: no staged candidate is recorded for this rollout, so ` +
        "there is nothing to expose or promote. Both run after a stage that " +
        "succeeded, in the same run.",
    );
  }
  return rollout;
}

/**
 * A Compose project as a canary platform, for `@zuke/canary`:
 *
 * ```ts
 * c.platform(dockerComposeCanary((d) =>
 *   d.service("app").canaryService("app-canary").replicas(4)
 *     .image(this.image.value)
 *     .stableImageVariable("APP_IMAGE")
 *     .canaryImageVariable("APP_CANARY_IMAGE")
 *     .compose((s) => s.file("compose.yml").projectName("shop"))
 * ))
 * ```
 *
 * The lambda runs on every call, so it may read resolved parameters; after
 * `stage`, the services, replicas and variables are the ones it recorded.
 * Every move is `up -d --no-deps --scale <service>=<n> <service>` (with
 * `--wait` when `n` is not 0), run with the image variables set:
 *
 * - **stage** — `ps --format {{.Image}} <stable>` reads the stable image,
 *   `pull --policy missing <canary>`, the rollout is recorded, then the
 *   stable service to every replica (`--no-recreate`) and the canary service
 *   to none.
 * - **expose** — the canary service to its share and the stable service
 *   (`--no-recreate`) to the rest, the growing one first; `ps` checks the
 *   canary runs the candidate.
 * - **promote** — the canary service to every replica, the stable service
 *   recreated on the candidate and checked with `ps`, the canary service to
 *   none. Not durable until the candidate is written where the stable
 *   variable comes from.
 * - **abort** — `ps` reads the stable replicas. If they all run the stable
 *   image, the stable service back to every replica (`--no-recreate`);
 *   otherwise the canary service to every replica on the stable image, the
 *   stable service recreated on it. Then the canary service to none. Run by
 *   hand, the stable image is the one set with `.stable(...)`.
 *
 * The stable service's `scale:` in the Compose file must equal
 * `.replicas(...)`, and Compose v2 (`docker compose`) is required.
 */
export function dockerComposeCanary(
  configure: Configure<DockerComposeCanarySettings>,
): DockerComposeCanary {
  return new DockerComposeCanary(configure);
}
