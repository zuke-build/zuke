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
 * sets that variable on the commands it runs. That is an override for the
 * one command, not a change to the project: see
 * {@link DockerComposeCanary.promote} for what that means for a promotion.
 *
 * The canary engine's platform interface lives in `@zuke/canary`, and a wrapper
 * depends only on `@zuke/core`, so this module does not import it: the object
 * {@link dockerComposeCanary} returns has the same shape and is accepted by
 * `c.platform(...)` as it is.
 *
 * @module
 */

import type { SummaryPairs, TargetStateHandle } from "@zuke/core";
import type { CommandOutput } from "@zuke/core/shell";
import type { Configure } from "@zuke/core/tooling";
import { DockerComposePsSettings } from "./containers.ts";
import { DockerComposePullSettings } from "./images.ts";
import { DockerComposeUpSettings } from "./lifecycle.ts";
import type { DockerComposeSettings } from "./settings.ts";

/**
 * The state key recording how far the rollout got: `"deploying"` before
 * `stage` reads or pulls anything, `"staged"` once the stable image is on
 * record, `"promoting"` from the first command of a promotion, and
 * `"promoted"` once it finished.
 */
const STAGE = "composeCanaryStage";

/** The state key the candidate image `stage` deployed is recorded under. */
const IMAGE = "composeCanaryImage";

/**
 * The state key the image the stable replicas ran before the rollout is
 * recorded under — what a rollback returns them to.
 */
const STABLE_IMAGE = "composeCanaryStableImage";

/** The state key holding how many canary replicas the last `expose` left. */
const CANARY_REPLICAS = "composeCanaryReplicas";

/** The Go template `compose ps` renders one container's image with. */
const IMAGE_TEMPLATE = "{{.Image}}";

/**
 * A Compose service name, which also becomes the left of `--scale
 * <service>=<n>` and a positional operand: starting with a letter or digit
 * keeps it from reading as a flag, and the character set keeps a `=` or `,`
 * from changing what `--scale` means.
 */
const SERVICE_SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/** An environment variable name that Compose's `${...}` can interpolate. */
const VARIABLE_SHAPE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The prefixes of the variables Docker and Compose read as their own settings
 * (`DOCKER_HOST`, `COMPOSE_FILE`, `COMPOSE_PROJECT_NAME`, …): an image
 * variable under one would redirect the command rather than name an image.
 */
const RESERVED_PREFIX = /^(?:DOCKER|COMPOSE)_/i;

/**
 * Runs one prepared Compose command and returns its output. `env` holds the
 * image variables the platform already applied to `settings` — handed over
 * as well so a runner that executes Compose some other way, or a test, sees
 * them. The default runs the settings; inject another with
 * {@link DockerComposeCanarySettings.runner}.
 */
export type DockerComposeSettingsRunner = (
  settings: DockerComposeSettings,
  env: Readonly<Record<string, string>>,
) => Promise<CommandOutput>;

/**
 * The part of the canary engine's context the Compose platform uses: the
 * rollout's durable state, where the images are recorded, and the build
 * summary. The engine hands a richer context; this is the narrow view.
 */
export interface DockerComposeCanaryContext {
  /** The rollout's durable platform state, shared by every call. */
  readonly state: TargetStateHandle;
  /** Add key/value pairs to the calling target's row in the build summary. */
  reportSummary(pairs: SummaryPairs): void;
}

/**
 * How {@link dockerComposeCanary} reaches the project, configured through its
 * lambda.
 */
export class DockerComposeCanarySettings {
  /** The service that serves the stable release (set by {@link service}). */
  service_?: string;
  /** The service that runs the candidate (set by {@link canaryService}). */
  canaryService_?: string;
  /** The replicas the two services share (set by {@link replicas}). */
  replicas_?: number;
  /** The candidate's image (set by {@link image}). */
  image_?: string;
  /** The variable the stable service's image reads (set by {@link stableImageVariable}). */
  stableImageVariable_?: string;
  /** The variable the canary service's image reads (set by {@link canaryImageVariable}). */
  canaryImageVariable_?: string;
  /** The image a hand-run rollback returns to (set by {@link stable}). */
  stable_?: string;
  /** Global Compose flags for every command (set by {@link compose}). */
  compose_?: Configure<DockerComposeSettings>;
  /** How each command is run (set by {@link runner}). */
  runner_: DockerComposeSettingsRunner = (settings) => settings.run();

  /**
   * The service that serves the stable release, e.g. `app`. It must already
   * be running: `stage` reads the image its replicas run, which is what a
   * rollback returns them to.
   */
  service(name: string): this {
    this.service_ = name;
    return this;
  }

  /**
   * The service that runs the candidate, e.g. `app-canary` — a second
   * service in the same project, behind the same proxy, whose `image:` is
   * `${<canaryImageVariable>}`. Give it `scale: 0` in the Compose file so a
   * plain `docker compose up` does not start it.
   */
  canaryService(name: string): this {
    this.canaryService_ = name;
    return this;
  }

  /**
   * How many replicas the stable and canary services share between them. A
   * step sets the canary to its share of this and the stable service to the
   * rest; `stage` and a rollback set the stable service to all of it. At
   * least 2, or there is nothing to split.
   */
  replicas(total: number): this {
    this.replicas_ = total;
    return this;
  }

  /** The candidate's image reference, which `stage` puts on the canary service. */
  image(reference: string): this {
    this.image_ = reference;
    return this;
  }

  /**
   * The environment variable the stable service's `image:` is — the whole
   * reference, as in `image: ${APP_IMAGE}`, not just a tag. Every command the
   * platform runs sets it, so the project's `.env` need not: to the image the
   * stable replicas ran when `stage` looked, to the candidate on promotion.
   * Not a `DOCKER_*` or `COMPOSE_*` name, which Docker and Compose read as
   * their own settings.
   */
  stableImageVariable(name: string): this {
    this.stableImageVariable_ = name;
    return this;
  }

  /**
   * The environment variable the canary service's `image:` is, as in
   * `image: ${APP_CANARY_IMAGE:-${APP_IMAGE}}`. Every command that brings up
   * the canary sets it to the candidate.
   */
  canaryImageVariable(name: string): this {
    this.canaryImageVariable_ = name;
    return this;
  }

  /**
   * The image to put the stable service back on when `rollout.abort` is run
   * by hand. Such a run is fresh, with no record of a rollout, so it has
   * nothing else to go on — and the release it is undoing has usually been
   * promoted already. A rollback the engine runs mid-rollout does not use it:
   * that one returns to the image `stage` saw the stable replicas running.
   */
  stable(image: string): this {
    this.stable_ = image;
    return this;
  }

  /**
   * Global flags for every Compose command the platform runs —
   * `(s) => s.file("compose.yml").projectName("shop")`, or `.usePlugin()` to
   * skip detection.
   */
  compose(configure: Configure<DockerComposeSettings>): this {
    this.compose_ = configure;
    return this;
  }

  /**
   * Replace how each prepared command is run. The default runs it; this is
   * for a test, or for a build that executes Compose through something else.
   */
  runner(run: DockerComposeSettingsRunner): this {
    this.runner_ = run;
    return this;
  }
}

/** The two services and the replicas they share, validated. */
interface Topology {
  stable: string;
  canary: string;
  replicas: number;
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
   * Read the image the stable replicas run and record it, make sure the
   * candidate image is available (pulled unless it is already present), and
   * bring the project to exactly 0 % — the stable service at every replica,
   * the canary service at none. The stable replicas are only added or
   * removed, never recreated.
   */
  async stage(ctx: DockerComposeCanaryContext): Promise<void> {
    const settings = this.#settings();
    const topology = topologyOf(settings);
    const image = settings.image_;
    if (image === undefined) {
      throw new Error(
        "dockerComposeCanary: no candidate image — add d.image(...), the " +
          "image the canary service runs.",
      );
    }
    const canaryVariable = canaryVariableOf(settings);
    const stableVariable = stableVariableOf(settings);
    await ctx.state.set({ [STAGE]: "deploying", [IMAGE]: image });
    // Compose loads the whole file for any command, so the stable variable
    // must resolve too. Neither the read nor the pull touches the stable
    // containers, and `ps` reports the image they actually run, so the
    // candidate stands in until the stable image is known.
    const read = { [canaryVariable]: image, [stableVariable]: image };
    const stableImage = await this.#servingImage(settings, topology, read);
    await this.#run(
      settings,
      new DockerComposePullSettings().policy("missing")
        .services(topology.canary),
      read,
    );
    // A rollback reads this to know what to return the stable service to, so
    // it must be on record before anything changes.
    if (
      !await ctx.state.trySet({
        [STAGE]: "staged",
        [STABLE_IMAGE]: stableImage,
      })
    ) {
      throw new Error(
        "dockerComposeCanary: could not record the stable image, so a " +
          "rollback could not return to it. Stopping before anything changes.",
      );
    }
    const env = { ...read, [stableVariable]: stableImage };
    await this.#scale(settings, topology.stable, topology.replicas, env, true);
    await this.#scale(settings, topology.canary, 0, env, false);
    ctx.reportSummary({ Candidate: image, Stable: stableImage });
  }

  /**
   * Run the canary service at `percent` of the replicas and the stable
   * service at the rest, and return the share actually reached. Any share
   * between 0 and 100 exclusive keeps at least one replica on each side, so a
   * step never rounds to an untested 0 % or a premature 100 %. Whichever
   * service grows is scaled first, so the total never dips below the
   * configured replicas. The stable replicas are never recreated.
   */
  async expose(
    percent: number,
    ctx: DockerComposeCanaryContext,
  ): Promise<number> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error(
        `dockerComposeCanary: an exposure is a share from 0 to 100, so it ` +
          `cannot be ${percent} %.`,
      );
    }
    const settings = this.#settings();
    const topology = topologyOf(settings);
    const staged = stagedImages(ctx);
    const env = {
      [canaryVariableOf(settings)]: staged.candidate,
      [stableVariableOf(settings)]: staged.stable,
    };
    const canary = canaryReplicas(percent, topology.replicas);
    const previous = ctx.state.get()[CANARY_REPLICAS];
    const grow = () =>
      this.#scale(settings, topology.canary, canary, env, false);
    const shrink = () =>
      this.#scale(
        settings,
        topology.stable,
        topology.replicas - canary,
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
    return Math.round(canary * 10000 / topology.replicas) / 100;
  }

  /**
   * Hand the stable service to the candidate: the canary service goes to
   * every replica, the stable service is recreated on the candidate image
   * with the stable variable set to it, and the canary service goes back to
   * none. The total never dips below the configured replicas; for a moment it
   * is twice that. Idempotent.
   *
   * **This is not durable on its own.** Compose has no state of its own to
   * change: the variable is set for these commands only. Until the
   * candidate is written where the stable variable comes from — the `.env`
   * file, or the environment of whatever runs `docker compose up` next — a
   * plain `docker compose up` puts the stable service back on the image that
   * source still names.
   */
  async promote(ctx: DockerComposeCanaryContext): Promise<void> {
    const settings = this.#settings();
    const topology = topologyOf(settings);
    if (ctx.state.get()[STAGE] === "promoted") return;
    const { candidate } = stagedImages(ctx);
    const env = {
      [canaryVariableOf(settings)]: candidate,
      [stableVariableOf(settings)]: candidate,
    };
    await ctx.state.set({ [STAGE]: "promoting" });
    await this.#scale(
      settings,
      topology.canary,
      topology.replicas,
      env,
      false,
    );
    await this.#scale(
      settings,
      topology.stable,
      topology.replicas,
      env,
      false,
    );
    await this.#scale(settings, topology.canary, 0, env, false);
    await ctx.state.set({ [STAGE]: "promoted", [CANARY_REPLICAS]: 0 });
  }

  /**
   * Put the stable service back on the stable image at every replica, then
   * take the canary service to none. Idempotent. Which image that is depends
   * on what this rollout recorded:
   *
   * - **`stage` recorded it** (a rollback mid-rollout, or after a promotion
   *   that failed part-way): the image the stable replicas ran before the
   *   rollout. Mid-rollout they still run it, so nothing is recreated.
   * - **`stage` failed before recording it**: nothing had changed, so nothing
   *   runs.
   * - **Nothing recorded** (`rollout.abort` run by hand, a fresh run): the
   *   image set with {@link DockerComposeCanarySettings.stable}. Without one
   *   this refuses, since claiming a rollback it cannot do would be worse.
   *
   * Like a promotion, the image is an override for these commands, so it
   * lasts until a plain `docker compose up` reads the variable from wherever
   * the project keeps it.
   */
  async abort(ctx: DockerComposeCanaryContext): Promise<void> {
    const settings = this.#settings();
    const topology = topologyOf(settings);
    const state = ctx.state.get();
    if (state[STAGE] === "deploying") return;
    const recorded = state[STABLE_IMAGE];
    const stableImage = typeof recorded === "string"
      ? recorded
      : handRunImage(settings, topology);
    // The canary service is scaled to none, so the image its variable names
    // is never run; setting it keeps every `${...}` in the file resolvable.
    const env = {
      [canaryVariableOf(settings)]: stableImage,
      [stableVariableOf(settings)]: stableImage,
    };
    await this.#scale(
      settings,
      topology.stable,
      topology.replicas,
      env,
      false,
    );
    await this.#scale(settings, topology.canary, 0, env, false);
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
    topology: Topology,
    env: Record<string, string>,
  ): Promise<string> {
    const ps = new DockerComposePsSettings().format(IMAGE_TEMPLATE)
      .services(topology.stable).quiet();
    const output = await this.#run(settings, ps, env);
    const images = new Set(
      output.stdout.split("\n").map((line) => line.trim()).filter((line) =>
        line !== ""
      ),
    );
    const [image, ...others] = images;
    if (image === undefined) {
      throw new Error(
        `dockerComposeCanary: the service ${topology.stable} has no running ` +
          "replicas, so there is no stable release to compare a canary " +
          "with or to roll back to. Bring it up first.",
      );
    }
    if (others.length > 0) {
      throw new Error(
        `dockerComposeCanary: the replicas of ${topology.stable} run ` +
          `different images (${[image, ...others].join(", ")}), so there is ` +
          "no one stable image to roll back to. Bring them onto one first.",
      );
    }
    return image;
  }

  /**
   * Run `command` with the caller's global flags, then the image variables —
   * applied last, so a global `.env(...)` cannot override them.
   */
  #run(
    settings: DockerComposeCanarySettings,
    command: DockerComposeSettings,
    env: Record<string, string>,
  ): Promise<CommandOutput> {
    settings.compose_?.(command);
    command.env(env);
    return settings.runner_(command, env);
  }
}

/** The configured services and replicas, or a friendly error naming the fix. */
function topologyOf(settings: DockerComposeCanarySettings): Topology {
  const stable = settings.service_;
  if (stable === undefined) {
    throw new Error(
      "dockerComposeCanary: no stable service named — add d.service('app'), " +
        "the service that serves the current release.",
    );
  }
  const canary = settings.canaryService_;
  if (canary === undefined) {
    throw new Error(
      "dockerComposeCanary: no canary service named — add " +
        "d.canaryService('app-canary'), a second service in the project that " +
        "runs the candidate behind the same proxy.",
    );
  }
  for (const name of [stable, canary]) {
    if (!SERVICE_SHAPE.test(name)) {
      throw new Error(
        `dockerComposeCanary: "${name}" is not a Compose service name — ` +
          "letters, digits, '_', '.' and '-', starting with a letter or digit.",
      );
    }
  }
  if (stable === canary) {
    throw new Error(
      `dockerComposeCanary: the stable and canary services are both ` +
        `${stable} — the canary needs a service of its own.`,
    );
  }
  const replicas = settings.replicas_;
  if (replicas === undefined) {
    throw new Error(
      "dockerComposeCanary: no replica count — add d.replicas(4), the " +
        "replicas the stable and canary services share.",
    );
  }
  if (!Number.isInteger(replicas) || replicas < 2) {
    throw new Error(
      `dockerComposeCanary: ${replicas} replicas cannot be split between a ` +
        "stable and a canary service — use a whole number of at least 2.",
    );
  }
  return { stable, canary, replicas };
}

/** The canary service's image variable, validated. */
function canaryVariableOf(settings: DockerComposeCanarySettings): string {
  return variableOf(
    settings.canaryImageVariable_,
    "d.canaryImageVariable('APP_CANARY_IMAGE'), the variable the canary " +
      "service's image: is",
  );
}

/** The stable service's image variable, validated and distinct. */
function stableVariableOf(settings: DockerComposeCanarySettings): string {
  const variable = variableOf(
    settings.stableImageVariable_,
    "d.stableImageVariable('APP_IMAGE'), the variable the stable service's " +
      "image: is",
  );
  if (variable === settings.canaryImageVariable_) {
    throw new Error(
      `dockerComposeCanary: the stable and canary services both read ` +
        `${variable}, so putting the candidate on the canary would put it on ` +
        "the stable service too. Give each service its own variable.",
    );
  }
  return variable;
}

/** A configured variable name, or a friendly error naming `fix`. */
function variableOf(value: string | undefined, fix: string): string {
  if (value === undefined) {
    throw new Error(`dockerComposeCanary: add ${fix}.`);
  }
  if (!VARIABLE_SHAPE.test(value)) {
    throw new Error(
      `dockerComposeCanary: "${value}" is not an environment variable name ` +
        "Compose can interpolate — letters, digits and '_', not starting " +
        "with a digit.",
    );
  }
  if (RESERVED_PREFIX.test(value)) {
    throw new Error(
      `dockerComposeCanary: ${value} is one of Docker's or Compose's own ` +
        "settings, so setting it to an image would change which daemon, " +
        "file or project the command uses. Name the image variable something " +
        "else, such as APP_IMAGE.",
    );
  }
  return value;
}

/** The candidate and stable images `stage` recorded, or a friendly error. */
function stagedImages(
  ctx: DockerComposeCanaryContext,
): { candidate: string; stable: string } {
  const state = ctx.state.get();
  const candidate = state[IMAGE];
  const stable = state[STABLE_IMAGE];
  if (typeof candidate !== "string" || typeof stable !== "string") {
    throw new Error(
      "dockerComposeCanary: no staged candidate is recorded for this " +
        "rollout, so there is nothing to expose or promote. Both run after " +
        "a stage that succeeded, in the same run.",
    );
  }
  return { candidate, stable };
}

/** The image a hand-run rollback returns to, or a refusal naming the fix. */
function handRunImage(
  settings: DockerComposeCanarySettings,
  topology: Topology,
): string {
  const stable = settings.stable_;
  if (stable === undefined || stable === "") {
    throw new Error(
      `dockerComposeCanary: this abort has no record of a rollout of ` +
        `${topology.stable} — it was run by hand — so it does not know which ` +
        "image to go back to. Add d.stable('<image>') to put the stable " +
        "service back on it, or use `zuke cancel <run-id>` for a rollout " +
        "that is still running.",
    );
  }
  return stable;
}

/**
 * The canary replicas for `percent` of `total`: the nearest whole replica,
 * but at least one and leaving at least one stable when the share is
 * strictly between 0 and 100.
 */
function canaryReplicas(percent: number, total: number): number {
  const nearest = Math.round(total * percent / 100);
  if (percent === 0 || percent === 100) return nearest;
  return Math.min(Math.max(nearest, 1), total - 1);
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
 * The lambda runs on every call, so it may read resolved parameters. Every
 * command is `up -d --no-deps --scale <service>=<n> <service>` (with `--wait`
 * when `n` is not 0), run with the image variables set:
 *
 * - **stage** — `ps --format {{.Image}} <stable>` records the stable image,
 *   `pull --policy missing <canary>`, then the stable service to every
 *   replica (`--no-recreate`) and the canary service to none.
 * - **expose** — the canary service to its share and the stable service
 *   (`--no-recreate`) to the rest, the growing one first.
 * - **promote** — the canary service to every replica, the stable service
 *   recreated on the candidate, the canary service to none. Not durable
 *   until the candidate is written where the stable variable comes from.
 * - **abort** — the stable service to every replica on the recorded stable
 *   image; run by hand, on the image set with `.stable(...)`. Then the canary
 *   service to none.
 */
export function dockerComposeCanary(
  configure: Configure<DockerComposeCanarySettings>,
): DockerComposeCanary {
  return new DockerComposeCanary(configure);
}
