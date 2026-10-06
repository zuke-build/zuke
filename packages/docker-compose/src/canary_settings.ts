// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * How {@link https://jsr.io/@zuke/docker-compose dockerComposeCanary} reaches a
 * Compose project: the fluent settings its lambda configures, the context the
 * canary engine hands each call, and the seam each command is run through.
 *
 * @module
 */

import type { SummaryPairs, TargetStateHandle } from "@zuke/core";
import type { CommandOutput } from "@zuke/core/shell";
import type { Configure } from "@zuke/core/tooling";
import type { DockerComposeSettings } from "./settings.ts";

/**
 * Runs one prepared Compose command and returns its output. `env` holds the
 * image variables the platform already applied to `settings` — handed over
 * as well so a runner that executes Compose some other way, or a test, sees
 * them. The default runs the settings; inject another with
 * {@link DockerComposeCanarySettings.runner}. An output with a non-zero exit
 * code fails the call, as a rejection does.
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
   * rest; `stage` and a rollback set the stable service to all of it. From 2
   * to 10000. Give the stable service the same `scale:` in the Compose file:
   * a plain `docker compose up` sets every service back to its `scale:`.
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
   * Not a name Docker, Compose or the process reads as a setting —
   * `DOCKER_*`, `COMPOSE_*`, `BUILDKIT_*`, `BUILDX_*`, `XDG_*`, `LD_*`,
   * `DYLD_*`, `*_PROXY`, `PATH`, `HOME`, `USERPROFILE`, `TMPDIR`, `TEMP` or
   * `TMP`, in any case — and not the canary's variable in another case.
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
   * by hand — a reference with no whitespace or control characters. Such a run is fresh, with no record of a rollout, so it has
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
   * skip detection. Compose v2 (`docker compose`) is required: the v1
   * `docker-compose` binary has no `--wait`, `pull --policy` or
   * `ps --format`. Trailing `.args(...)` are refused, since they would land
   * after the service each command names. A non-zero exit fails the call
   * even with `.noThrow()`.
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
