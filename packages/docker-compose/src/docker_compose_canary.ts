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
 * The services a rollout moves are named inside a Compose project, so `stage`
 * also records the project: the global flags `d.compose(...)` gives
 * (`-f`, `-p`, `--profile`, `--project-directory`, `--env-file`), as argv —
 * never what its `.env(...)` passes, which may be a secret. Every later call
 * with a record refuses, before any command, reads included, unless the
 * lambda gives exactly those flags again: a resumed or cancelling process
 * whose `.projectName(...)` resolves to another value would otherwise move
 * same-named services in a project the rollout never staged. Flags are
 * compared as written, in order.
 *
 * Flags are not all that selects the project: `COMPOSE_PROJECT_NAME` in the
 * environment, a `.env` or `--env-file` that sets it, and the working directory
 * a default name comes from do too. So `stage` also records the project Compose
 * itself reports the stable replicas in (the containers'
 * `com.docker.compose.project` label, stopped ones included), and every later
 * call with a record reads that label for every container of both services
 * with `ps -a <stable> <canary>` — after the flag check, before any other
 * command — and refuses unless it reports exactly that project. Compose
 * lists only the containers of the project it resolves, so this covers
 * whatever resolves it. `-a` counts stopped containers, so a daemon
 * restart that stopped them does not block the rollback, and a call that finds
 * no container of either service, running or stopped, refuses: a live rollout
 * always has some, since the total never dips.
 *
 * What the project check does not cover: the Docker daemon is not recorded, and
 * the recorded image IDs are only a partial guard against another one. After
 * `stage` every move passes `--pull never`, so one that creates a container
 * fails on a daemon that lacks its image — the recorded stable ID, or the
 * candidate — while one that only removes containers needs no image and goes
 * ahead; and the reads compare IDs, so a rollback finds stable replicas on
 * another image and a later step a canary on another candidate. A daemon or
 * context (`DOCKER_HOST`, `DOCKER_CONTEXT`, a `.toolPath(...)`) that runs the
 * same project name, with the same services on the same images, is not told
 * apart. Nor is a change that keeps the project but changes the services'
 * definitions: another `COMPOSE_FILE`, an env file that changes what they
 * interpolate, or — with an explicit `-p` and no `-f` — a working directory or
 * `.cwd(...)` that loads another `compose.yml` under the same project name. And
 * the lambda's `.env(...)` and `.cwd(...)` are checked only through the project
 * read at the start of each call; every later command re-checks only its flags,
 * so the lambda must give the same `.env(...)` and `.cwd(...)` every time it
 * runs.
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
  CANDIDATE_ID,
  candidateOf,
  handRunRollback,
  imageIdOf,
  imageOf,
  isImageId,
  projectNameOf,
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
  applyScope,
  checkProject,
  checkScope,
  composeScope,
} from "./canary_scope.ts";
import {
  type DockerComposeCanaryContext,
  DockerComposeCanarySettings,
} from "./canary_settings.ts";
import { DockerComposePsSettings } from "./containers.ts";
import { DockerComposePullSettings } from "./images.ts";
import { DockerComposeImagesSettings } from "./inventory.ts";
import { DockerComposeUpSettings } from "./lifecycle.ts";
import type { DockerComposeSettings } from "./settings.ts";

/** The Go template `compose ps` renders one container's image with. */
const IMAGE_TEMPLATE = "{{.Image}}";

/**
 * The Go template `compose ps` renders one container's project with: the
 * `com.docker.compose.project` label of a container Compose listed because
 * it is in the project Compose resolved. `.Label` exists from Compose 2.21;
 * the shorter `{{.Project}}` only from 2.24.
 */
const PROJECT_TEMPLATE = '{{.Label "com.docker.compose.project"}}';

/**
 * A call's view of the project: the settings, and the global flags it
 * resolved once at its start, which every command it runs must carry.
 */
interface Project {
  /** The settings the lambda produced for this call. */
  readonly settings: DockerComposeCanarySettings;
  /** The global flags of every command this call runs. */
  readonly scope: readonly string[];
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
   * two services, the replicas, the two variables, the two images and the
   * stable replicas' image ID (`images --quiet`), which every later call acts
   * on whatever the lambda says then, and the project — its global flags
   * and the project Compose reports the stable replicas in, which every
   * later call refuses to run without — and bring the
   * project to exactly 0 %: the stable service at every replica, the canary
   * service at none. The stable replicas are only added or removed, never
   * recreated.
   *
   * Each call runs `d.compose(...)` once to resolve the global flags, and
   * then once per command; a command it gives any other flags (a lambda that
   * reads a clock, or changes what it closes over) is refused before it runs.
   * A stage always starts afresh, so a re-run one records the flags it runs
   * with.
   *
   * What the project check does not cover: the Docker daemon is not recorded,
   * and the recorded image IDs are only a partial guard against another one.
   * After `stage` every move passes `--pull never`, so one that creates a
   * container fails on a daemon that lacks its image — the recorded stable ID,
   * or the candidate — while one that only removes containers needs no image
   * and goes ahead; and the reads compare IDs, so a rollback finds stable
   * replicas on another image and a later step a canary on another candidate. A
   * daemon or context (`DOCKER_HOST`, `DOCKER_CONTEXT`, a `.toolPath(...)`)
   * that runs the same project name, with the same services on the same images,
   * is not told apart. Nor is a change that keeps the project but changes the
   * services' definitions: another `COMPOSE_FILE`, an env file that changes
   * what they interpolate, or — with an explicit `-p` and no `-f` — a working
   * directory or `.cwd(...)` that loads another `compose.yml` under the same
   * project name. And the lambda's `.env(...)` and `.cwd(...)` are checked only
   * through the project read at the start of each call; every later command
   * re-checks only its flags, so the lambda must give the same `.env(...)` and
   * `.cwd(...)` every time it runs.
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
    // Resolved once: every command below carries exactly these flags, and
    // the record holds them for every later call to check.
    const project = { settings, scope: composeScope(settings.compose_) };
    // Compose loads the whole file for any command, so the stable variable
    // must resolve too. Neither the read nor the pull touches the stable
    // containers, and `ps` reports the image they actually run, so the
    // candidate stands in until the stable image is known.
    const read = imageEnv(vars, candidate, candidate);
    const stableImage = await this.#servingImage(
      project,
      topology.stable,
      read,
    );
    // Every command that may create a stable replica from here on sets the
    // stable variable to this ID, not the reference: a mutable tag moved by a
    // local pull or build mid-rollout must not put a release nobody analysed
    // into the stable service.
    const restore = await this.#oneImageId(
      project,
      topology.stable,
      read,
      "so there is no one stable image to roll back to. Bring them onto one " +
        "first",
    );
    // The project Compose resolved, from the flags and from whatever else
    // selects it — COMPOSE_PROJECT_NAME, a .env or env file, the working
    // directory — which every later call must find the services in again.
    const projectName = await this.#stableProject(
      project,
      topology.stable,
      read,
    );
    await this.#run(
      project,
      new DockerComposePullSettings().policy("missing")
        .services(topology.canary),
      read,
    );
    const rollout: Rollout = {
      ...topology,
      ...vars,
      candidate,
      stableImage,
      restore,
      scope: project.scope,
      projectName,
    };
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
    const env = imageEnv(vars, restore, candidate);
    await this.#scale(project, topology.stable, topology.replicas, env, true);
    await this.#scale(project, topology.canary, 0, env, false);
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
   * variable is refused rather than analysed — and `images --quiet` must
   * resolve them to one image ID. The first step records that ID, as the
   * image the analysis judges; every later step and promote set the canary
   * variable to it rather than the tag, and refuse a canary that resolves to
   * another. The stable replicas are never recreated. The services and
   * replicas are the ones `stage` recorded, and the call refuses before any
   * command unless `d.compose(...)` still gives the global flags `stage`
   * recorded, and before any other unless the project read (`ps -a` with
   * the project label) reports the two services in the project `stage` saw.
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
    const state = ctx.state.get();
    const rollout = staged(recordedRollout(state));
    const project = await this.#recorded(rollout);
    const env = imageEnv(
      rollout,
      rollout.restore,
      rollout.candidateId ?? rollout.candidate,
    );
    const canary = canaryReplicas(percent, rollout.replicas);
    const previous = state[CANARY_REPLICAS];
    // The canary replicas already running are the pinned candidate (checked
    // below), so a step only adds or removes them: a recreate would restart
    // what the analysis is watching.
    const grow = async () => {
      await this.#scale(project, rollout.canary, canary, env, true);
      if (canary > 0) await this.#pinCandidate(project, ctx, rollout, env);
    };
    const shrink = () =>
      this.#scale(
        project,
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
   * every replica, the stable service is recreated with the stable variable
   * set to the candidate's recorded image ID — the image the analysis judged,
   * whatever the candidate tag names by now — `images --quiet` must then
   * resolve every stable replica to that ID — or the call refuses, before it
   * is recorded as promoted, since a stable `image:` that does not read the
   * variable would have changed nothing — and the canary service goes back
   * to none. The
   * total never dips below the replicas; for a moment it is twice that.
   * Idempotent. Like every call after `stage`, it refuses before any command
   * unless `d.compose(...)` still gives the global flags `stage` recorded,
   * and before any other unless the project read (`ps -a` with the project
   * label) reports the two services in the project `stage` saw.
   *
   * **This is not durable on its own.** Compose has no state of its own to
   * change: the variable is set for these commands only. Until the
   * candidate is written where the stable variable comes from — the `.env`
   * file, or the environment of whatever runs `docker compose up` next — a
   * plain `docker compose up` puts the stable service back on the image that
   * source still names, and at the replica count its `scale:` names, which
   * is why that must equal {@link DockerComposeCanarySettings.replicas}. The
   * build summary says so: `Persist: set APP_IMAGE=<candidate> (which must
   * resolve to sha256:<id>) and keep scale: <replicas>`.
   */
  async promote(ctx: DockerComposeCanaryContext): Promise<void> {
    const state = ctx.state.get();
    if (state[STAGE] === "promoted") return;
    const rollout = staged(recordedRollout(state));
    const project = await this.#recorded(rollout);
    await ctx.state.set({ [STAGE]: "promoting" });
    const surge = imageEnv(
      rollout,
      rollout.restore,
      rollout.candidateId ?? rollout.candidate,
    );
    await this.#scale(
      project,
      rollout.canary,
      rollout.replicas,
      surge,
      true,
    );
    // With no step before it, the canary first runs here, so this is where
    // the candidate's ID is pinned.
    const id = rollout.candidateId ??
      await this.#pinCandidate(project, ctx, rollout, surge);
    const env = imageEnv(rollout, id, id);
    await this.#scale(
      project,
      rollout.stable,
      rollout.replicas,
      env,
      false,
    );
    await this.#requireStable(project, rollout, id, true, env);
    await this.#scale(project, rollout.canary, 0, env, false);
    // Reported before the promotion is recorded: a process that dies between
    // the two re-drives the promotion, which reports it again, rather than
    // finding it recorded and saying nothing.
    ctx.reportSummary(persist(rollout, rollout.candidate, id));
    await ctx.state.set({ [STAGE]: "promoted" });
  }

  /**
   * Put every replica back on the stable image, in the stable service, with
   * the canary service at none. Idempotent. Which image, services and
   * replicas depends on what this rollout recorded:
   *
   * - **`stage` recorded them** (a rollback mid-rollout, or after a
   *   promotion that failed part-way): the ones `stage` saw, whatever the
   *   lambda says now — in the project `stage` saw, too: unless
   *   `d.compose(...)` still gives the global flags `stage` recorded, this
   *   refuses before any command, and unless the project read (`ps -a`
   *   with the project label) then reports the two services in the
   *   project `stage` saw, before any other. Since the engine then leaves the run cancelled, the refusal
   *   names the recovery: the configuration and environment set back, and
   *   `rollout.abort` run by hand with
   *   `d.stable('sha256:<the recorded stable image ID>')`.
   * - **`stage` failed before recording them**: nothing had changed, so
   *   nothing runs — and the settings are not even read.
   * - **Nothing recorded** (`rollout.abort` run by hand, a fresh run): the
   *   settings, with the image set by
   *   {@link DockerComposeCanarySettings.stable}. Without one this refuses,
   *   since claiming a rollback it cannot do would be worse.
   *
   * Every command sets the stable variable to the image ID `stage` recorded,
   * not to the reference, so a tag moved since cannot bring in an image
   * nobody analysed; run by hand, there is only the reference.
   *
   * First it reads what the stable replicas run: on a recorded rollout,
   * `images --quiet` must resolve them to exactly the recorded ID — a tag
   * `ps` shows means whatever the tag names now, so it is not evidence; run
   * by hand, `ps` must show every one on the `.stable(...)` reference. When
   * they do — mid-rollout they do — the stable service is only
   * scaled back to every replica (`--no-recreate`). Otherwise — after a
   * promotion, run by hand or part-way — the stable replicas must be
   * recreated, which Compose does to all of them at once, so the rollback
   * mirrors a promotion: the canary service first goes to every replica on
   * the stable image, then the stable service is recreated on it, then the
   * canary service goes to none. Capacity never dips. Either way, before
   * the canary goes to none, the stable replicas are read again — by ID on a
   * recorded rollout, by reference run by hand — and a stable `image:` that
   * does not read its variable is refused, leaving the canary serving,
   * rather than reported as rolled back.
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
    const recorded = recordedRollout(state);
    const { project, rollback } = recorded === undefined
      ? this.#handRun()
      : { project: await this.#recorded(recorded), rollback: recorded };
    const image = rollback.restore;
    // The canary service only ever runs the stable image here — a surge while
    // the stable replicas are recreated — so its variable names that too.
    const env = imageEnv(rollback, image, image);
    if (await this.#onStable(project, rollback, recorded !== undefined, env)) {
      await this.#scale(
        project,
        rollback.stable,
        rollback.replicas,
        env,
        true,
      );
    } else {
      await this.#scale(
        project,
        rollback.canary,
        rollback.replicas,
        env,
        false,
      );
      await this.#scale(
        project,
        rollback.stable,
        rollback.replicas,
        env,
        false,
      );
    }
    // A stable image: that does not read the variable makes the move a no-op
    // — or, from no replicas, creates them on the wrong image — and reporting
    // a rollback then would be a lie. The canary keeps serving while someone
    // looks.
    await this.#requireStable(
      project,
      rollback,
      image,
      recorded !== undefined,
      env,
    );
    await this.#scale(project, rollback.canary, 0, env, false);
    if (recorded === undefined) ctx.reportSummary(persist(rollback, image));
  }

  /**
   * Whether every stable replica already runs the image a rollback restores:
   * by ID on a recorded rollout, by the configured reference on a hand-run
   * one, which has no ID to go on.
   */
  async #onStable(
    project: Project,
    rollback: Rollback,
    recorded: boolean,
    env: Record<string, string>,
  ): Promise<boolean> {
    if (recorded) {
      const ids = await this.#imageIds(project, rollback.stable, env);
      return ids.length === 1 && ids[0] === rollback.restore;
    }
    // No running replica is not "on the stable image": stopped ones are
    // started as they were by a scale that keeps them, so they are recreated.
    const running = await this.#runningImages(project, rollback.stable, env);
    return running.length > 0 &&
      running.every((each) => each === rollback.restore);
  }

  /**
   * Refuse unless every stable replica runs `image`, which the platform just
   * set the stable variable to: by ID through `images --quiet` when `byId`,
   * or by the reference `ps` shows — all a hand-run rollback has.
   */
  async #requireStable(
    project: Project,
    rollback: Rollback,
    image: string,
    byId: boolean,
    env: Record<string, string>,
  ): Promise<void> {
    const shown = byId
      ? await this.#imageIds(project, rollback.stable, env)
      : await this.#runningImages(project, rollback.stable, env);
    if (shown.length === 0 || shown.some((each) => each !== image)) {
      throw unread(rollback.stable, shown, rollback.stableVariable, image);
    }
  }

  /**
   * Check the canary replicas run the candidate, and pin its image ID:
   * `images --quiet` must resolve them to one ID — recorded the first time,
   * and required to match it after — and `ps` must show each on the
   * candidate's reference or that ID (a replica created from the tag shows
   * the ID once the tag has moved).
   */
  async #pinCandidate(
    project: Project,
    ctx: DockerComposeCanaryContext,
    rollout: Rollout,
    env: Record<string, string>,
  ): Promise<string> {
    const variable = rollout.canaryVariable;
    const running = await this.#runningImages(project, rollout.canary, env);
    if (running.length === 0) {
      throw unread(rollout.canary, running, variable, env[variable]);
    }
    const id = await this.#oneImageId(
      project,
      rollout.canary,
      env,
      "so there is no one candidate image for the analysis to judge",
    );
    if (running.some((each) => each !== rollout.candidate && each !== id)) {
      throw unread(rollout.canary, running, variable, env[variable]);
    }
    if (rollout.candidateId === undefined) {
      await ctx.state.set({ [CANDIDATE_ID]: id });
    } else if (id !== rollout.candidateId) {
      throw new Error(
        `${CALLER}: the canary replicas of ${rollout.canary} resolve to ${id}, ` +
          `not the ${rollout.candidateId} an earlier step ran — the ` +
          `candidate tag ${rollout.candidate} has moved. Start a new rollout ` +
          "for the image it names now.",
      );
    }
    return id;
  }

  /** The settings, evaluated now so the lambda sees resolved parameters. */
  #settings(): DockerComposeCanarySettings {
    return this.#configure(new DockerComposeCanarySettings());
  }

  /**
   * The project for a call with a record: the settings, refused — before any
   * command — unless their global flags are the ones `stage` recorded, and
   * then, before any other command, unless the project read (`ps -a` with
   * the project label) with those flags reports the two services in
   * exactly the project `stage` saw. The recorded services mean something only in that project, and
   * Compose resolves it from more than the flags.
   */
  async #recorded(rollout: Rollout): Promise<Project> {
    const settings = this.#settings();
    const scope = composeScope(settings.compose_);
    checkScope(rollout, scope);
    const project = { settings, scope };
    const env = imageEnv(
      rollout,
      rollout.restore,
      rollout.candidateId ?? rollout.candidate,
    );
    checkProject(
      rollout,
      await this.#projects(project, [rollout.stable, rollout.canary], env),
    );
    return project;
  }

  /**
   * The one project the replicas of `service` are in, as Compose
   * reports it, or a refusal.
   */
  async #stableProject(
    project: Project,
    service: string,
    env: Record<string, string>,
  ): Promise<string> {
    const [name, ...others] = new Set(
      await this.#projects(project, [service], env),
    );
    // Compose lists one project's containers, so several cannot happen; the
    // output is still checked, as untrusted, the way imageOf checks an image.
    if (name === undefined || others.length > 0) {
      throw new Error(
        `${CALLER}: Compose reports the replicas of ${service} in ` +
          `${
            name === undefined
              ? "no project"
              : `several projects (${[name, ...others].join(", ")})`
          }, so there is no one project for the rollout to stay in.`,
      );
    }
    return projectNameOf(name, `the project ps reported for ${service}`);
  }

  /**
   * The project label of each container of `services`, running or stopped,
   * as `ps -a --format '{{.Label "com.docker.compose.project"}}'` prints
   * them.
   */
  #projects(
    project: Project,
    services: string[],
    env: Record<string, string>,
  ): Promise<string[]> {
    return this.#lines(
      project,
      new DockerComposePsSettings().all().format(PROJECT_TEMPLATE)
        .services(...services),
      env,
      `the projects of ${services.join(" and ")}`,
    );
  }

  /**
   * The project and rollback for `rollout.abort` run by hand: the settings,
   * with no record to check them against.
   */
  #handRun(): { project: Project; rollback: Rollback } {
    const settings = this.#settings();
    const rollback = handRunRollback(settings);
    return {
      project: { settings, scope: composeScope(settings.compose_) },
      rollback,
    };
  }

  /**
   * `up -d --no-deps --scale <service>=<count> <service>`, waiting for the
   * replicas when there are any. With `keep`, replicas that already exist
   * are not recreated (`--no-recreate`), so only the count changes. When a
   * variable is set to an image ID, `--pull never`.
   */
  #scale(
    project: Project,
    service: string,
    count: number,
    env: Record<string, string>,
    keep: boolean,
  ): Promise<CommandOutput> {
    const up = new DockerComposeUpSettings().detach().noDeps();
    if (count > 0) up.wait();
    if (keep) up.noRecreate();
    // An ID cannot be pulled, and a service's pull_policy: always would try:
    // whatever an ID names is local already, since a container ran it.
    if (Object.values(env).some(isImageId)) up.pull("never");
    return this.#run(project, up.scale(service, count).services(service), env);
  }

  /** The one image the stable service's running replicas use. */
  async #servingImage(
    project: Project,
    service: string,
    env: Record<string, string>,
  ): Promise<string> {
    const [image, ...others] = new Set(
      await this.#runningImages(project, service, env),
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
   * The distinct image IDs of `service`'s replicas, from `images --quiet`,
   * which prints each once — and, unlike `ps`, counts stopped replicas too.
   */
  async #imageIds(
    project: Project,
    service: string,
    env: Record<string, string>,
  ): Promise<string[]> {
    const lines = await this.#lines(
      project,
      new DockerComposeImagesSettings().quietOutput().services(service),
      env,
      `the image IDs of ${service}`,
    );
    return [
      ...new Set(
        lines.map((line) =>
          imageIdOf(line, `an image ID images reported for ${service}`)
        ),
      ),
    ];
  }

  /** The one image ID `service`'s replicas resolve to, or a refusal ending `why`. */
  async #oneImageId(
    project: Project,
    service: string,
    env: Record<string, string>,
    why: string,
  ): Promise<string> {
    const [id, ...others] = await this.#imageIds(project, service, env);
    if (id === undefined || others.length > 0) {
      throw new Error(
        `${CALLER}: the replicas of ${service} resolve to ` +
          `${
            id === undefined
              ? "no image ID"
              : `several image IDs (${[id, ...others].join(", ")}) — ` +
                "images counts stopped replicas and one-off `docker compose " +
                "run` containers too, so remove any left on another image " +
                "with `docker compose rm` (and use `run --rm`) —"
          } ${why}.`,
      );
    }
    return id;
  }

  /**
   * The image of each running replica of `service`, as
   * `ps --format {{.Image}}` prints them.
   */
  async #runningImages(
    project: Project,
    service: string,
    env: Record<string, string>,
  ): Promise<string[]> {
    const lines = await this.#lines(
      project,
      new DockerComposePsSettings().format(IMAGE_TEMPLATE).services(service),
      env,
      `the images of ${service}`,
    );
    return lines.map((line) =>
      imageOf(line, `an image ps reported for ${service}`)
    );
  }

  /**
   * The non-empty lines `command` prints, trimmed. A truncated capture is
   * refused: capture keeps the newest bytes, so the first line may begin
   * mid-value.
   */
  async #lines(
    project: Project,
    command: DockerComposeSettings,
    env: Record<string, string>,
    what: string,
  ): Promise<string[]> {
    const output = await this.#run(project, command.quiet(), env);
    if (output.truncated) {
      throw new Error(
        `${CALLER}: compose printed more than the ` +
          `${output.maxCapturedBytes}-byte capture cap kept listing ${what}, ` +
          "and capture drops the oldest bytes — raise it with " +
          "d.compose((s) => s.maxCapturedBytes(bytes)).",
      );
    }
    return output.stdout.split("\n").map((line) => line.trim())
      .filter((line) => line !== "");
  }

  /**
   * Run `command` with the caller's global flags, then the image variables —
   * applied last, so a global `.env(...)` cannot override them — and refuse a
   * non-zero exit even when the global flags said not to throw.
   */
  async #run(
    project: Project,
    command: DockerComposeSettings,
    env: Record<string, string>,
  ): Promise<CommandOutput> {
    const settings = project.settings;
    applyScope(settings.compose_, project.scope, command);
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
 * project. Operators persist the reference; when the platform installed an
 * ID, the pair names the ID that reference must still resolve to.
 */
function persist(
  rollback: Rollback,
  image: string,
  id?: string,
): { Persist: string } {
  const pin = id === undefined ? "" : ` (which must resolve to ${id})`;
  return {
    Persist: `set ${rollback.stableVariable}=${image}${pin} and keep ` +
      `scale: ${rollback.replicas}`,
  };
}

/**
 * The refusal for a service that does not run what the platform just set its
 * variable to: its `image:` does not read the variable, so the move changed
 * nothing.
 */
function unread(
  service: string,
  shown: readonly string[],
  variable: string,
  value: string,
): Error {
  return new Error(
    `${CALLER}: the service ${service} runs ` +
      `${shown.length === 0 ? "nothing" : shown.join(", ")} after the ` +
      `platform set ${variable} to ${value}, so its image: does not read ` +
      `that variable. Make it image: \${${variable}}.`,
  );
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
 * `stage`, the services, replicas and variables are the ones it recorded, and
 * every call refuses unless `d.compose(...)` gives the global flags `stage`
 * recorded and Compose reports the two services in the project `stage` saw.
 * Every move is `up -d --no-deps --scale <service>=<n> <service>` (with
 * `--wait` when `n` is not 0), run with the image variables set:
 *
 * - **stage** — `ps --format {{.Image}} <stable>` reads the stable image,
 *   `images --quiet <stable>` its ID and
 *   `ps -a --format '{{.Label "com.docker.compose.project"}}' <stable>` its
 *   one project, `pull --policy missing <canary>`,
 *   the rollout is recorded, then the stable service to every replica
 *   (`--no-recreate`) and the canary service to none. From here on, the
 *   stable variable is the recorded `sha256:<id>` on every command that may
 *   create a stable replica, and every move that sets an ID adds
 *   `--pull never`, since an ID cannot be pulled.
 * - **expose, promote, abort with a record** — first
 *   `ps -a --format '{{.Label "com.docker.compose.project"}}' <stable>
 *   <canary>`, which must report exactly the recorded project.
 * - **expose** — the canary service (`--no-recreate`) to its share and the
 *   stable service (`--no-recreate`) to the rest, the growing one first;
 *   `ps` checks the canary runs the candidate and `images --quiet` pins its
 *   ID on the first step, which later steps and promote then use.
 * - **promote** — the canary service to every replica, the stable service
 *   recreated on the pinned candidate ID and checked with `images --quiet`,
 *   the canary service to none. Not durable until the candidate is written
 *   where the stable variable comes from.
 * - **abort** — `images --quiet` reads the stable replicas' IDs (run by
 *   hand, `ps` their references). If they are all on the stable image, the
 *   stable service back to every replica (`--no-recreate`); otherwise the
 *   canary service to every replica on the stable image, the stable service
 *   recreated on it. The stable replicas are then read again and must be
 *   on the stable image, before the canary service goes to none. Run by
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
