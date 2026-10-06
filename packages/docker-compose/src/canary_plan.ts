// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What a Compose canary rollout acts on — the two services, the replicas they
 * share, the two image variables and the two images — validated, whether it
 * comes from the settings or from the record `stage` left.
 *
 * Internal to the package: not exported from `mod.ts`. Every call after
 * `stage` acts on the record, so a resumed or cancelling process whose lambda
 * resolves differently still moves the services the rollout started with —
 * and refuses outright when the lambda now selects another Compose project
 * (see `canary_scope.ts`); only a hand-run rollback, which has no record,
 * reads the settings.
 *
 * @module
 */

import type { JsonValue } from "@zuke/core";
import type { DockerComposeCanarySettings } from "./canary_settings.ts";

/** The name every message from the platform starts with. */
export const CALLER = "dockerComposeCanary";

/**
 * The state key recording how far the rollout got: `"deploying"` before
 * `stage` reads or validates anything, `"staged"` once the rollout is on
 * record, `"promoting"` from the first command of a promotion, and
 * `"promoted"` once it finished.
 */
export const STAGE = "composeCanaryStage";

/**
 * The state key the candidate's image ID is recorded under, by the first call
 * that runs a canary replica: the image the analysis judges, which promote
 * installs whatever the candidate tag names by then.
 */
export const CANDIDATE_ID = "composeCanaryCandidateId";

/** The state key holding how many canary replicas the last `expose` left. */
export const CANARY_REPLICAS = "composeCanaryReplicas";

/** The state keys `stage` records the rollout under, in one write. */
const RECORD = {
  stable: "composeCanaryService",
  canary: "composeCanaryCanaryService",
  replicas: "composeCanaryTotal",
  stableVariable: "composeCanaryStableVariable",
  canaryVariable: "composeCanaryCanaryVariable",
  candidate: "composeCanaryImage",
  stableImage: "composeCanaryStableImage",
  stableImageId: "composeCanaryStableImageId",
  scope: "composeCanaryProject",
  projectName: "composeCanaryProjectName",
} as const;

/** The most replicas the two services may share. */
const MAX_REPLICAS = 10_000;

/**
 * A Compose service name (the compose-spec's `[a-zA-Z0-9._-]+`), which also
 * becomes the left of `--scale <service>=<n>` and a positional operand: not
 * starting with `-` keeps it from reading as a flag, and the character set
 * keeps a `=` or `,` from changing what `--scale` means.
 */
const SERVICE_SHAPE = /^[a-zA-Z0-9._][a-zA-Z0-9._-]*$/;

/** An environment variable name that Compose's `${...}` can interpolate. */
const VARIABLE_SHAPE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Variables Docker, Compose, BuildKit or the process itself read as settings
 * (`DOCKER_HOST`, `COMPOSE_FILE`, `PATH`, `HTTPS_PROXY`, `LD_PRELOAD`,
 * `SystemRoot`, `SSH_AUTH_SOCK`, …): an
 * image variable named one of them would redirect the command, or break it,
 * rather than name an image. Matched without regard to case, as Windows reads
 * them.
 */
const RESERVED_VARIABLE = new RegExp(
  "^(?:(?:DOCKER|COMPOSE|BUILDKIT|BUILDX|XDG|LD|DYLD)_.*|.*_PROXY|PATH|" +
    "PATHEXT|HOME|USERPROFILE|SystemRoot|TMPDIR|TEMP|TMP|SSH_AUTH_SOCK|" +
    "SSL_CERT_FILE|SSL_CERT_DIR)$",
  "i",
);

/**
 * A full image ID, as `images --quiet` prints it (bare hex) or `ps` reports
 * it (`sha256:` first).
 */
const IMAGE_ID_SHAPE = /^(?:sha256:)?([0-9a-f]{64})$/;

/**
 * An image reference as an environment value: something, with no whitespace
 * or control characters that would make Compose read a different reference
 * than the one recorded or reported.
 */
const IMAGE_SHAPE = /^[^\s\p{Cc}]+$/u;

/**
 * A Compose project name as Compose normalises it and labels containers
 * with: lowercase letters, digits, `_` and `-`, starting with a letter or
 * digit.
 */
const PROJECT_SHAPE = /^[a-z0-9][a-z0-9_-]*$/;

/** The two services and the replicas they share. */
export interface Topology {
  /** The service that serves the stable release. */
  readonly stable: string;
  /** The service that runs the candidate. */
  readonly canary: string;
  /** The replicas the two share. */
  readonly replicas: number;
}

/** The variables the two services' `image:` read. */
export interface Variables {
  /** The stable service's image variable. */
  readonly stableVariable: string;
  /** The canary service's image variable. */
  readonly canaryVariable: string;
}

/** What a rollback acts on: the services, the variables, the images. */
export interface Rollback extends Topology, Variables {
  /** The reference of the image the stable service goes back to. */
  readonly stableImage: string;
  /**
   * What the stable variable is set to on every command that may create a
   * stable replica: the recorded image ID, so a tag moved since cannot put a
   * release nobody analysed in; for a hand-run rollback, the reference.
   */
  readonly restore: string;
}

/** Everything `stage` recorded, which every later call acts on. */
export interface Rollout extends Rollback {
  /** The candidate image `stage` put on the canary service. */
  readonly candidate: string;
  /**
   * The candidate's image ID, once a canary replica has run it; until then
   * there is none.
   */
  readonly candidateId?: string;
  /**
   * The global flags `d.compose(...)` gave when `stage` ran — which project
   * the services are in. Every later call refuses unless the lambda still
   * gives exactly these.
   */
  readonly scope: readonly string[];
  /**
   * The project the stable replicas belonged to when `stage` ran, as
   * `ps --format {{.Project}}` reported it. Every later call refuses unless
   * Compose still reports the two services in it.
   */
  readonly projectName: string;
}

/** The configured services and replicas, or a friendly error naming the fix. */
export function topologyOf(settings: DockerComposeCanarySettings): Topology {
  return topology(
    named(
      settings.service_,
      "no stable service named — add d.service('app'), the service that " +
        "serves the current release.",
    ),
    named(
      settings.canaryService_,
      "no canary service named — add d.canaryService('app-canary'), a " +
        "second service in the project that runs the candidate behind the " +
        "same proxy.",
    ),
    settings.replicas_,
  );
}

/** The configured image variables, validated and distinct. */
export function variablesOf(settings: DockerComposeCanarySettings): Variables {
  const canary = named(
    settings.canaryImageVariable_,
    "add d.canaryImageVariable('APP_CANARY_IMAGE'), the variable the " +
      "canary service's image: is.",
  );
  const stable = named(
    settings.stableImageVariable_,
    "add d.stableImageVariable('APP_IMAGE'), the variable the stable " +
      "service's image: is.",
  );
  return variables(stable, canary);
}

/** The configured candidate image, or a friendly error naming the fix. */
export function candidateOf(settings: DockerComposeCanarySettings): string {
  return imageOf(
    named(
      settings.image_,
      "no candidate image — add d.image(...), the image the canary service " +
        "runs.",
    ),
    "the candidate image",
  );
}

/**
 * What a hand-run rollback acts on — the settings, since there is no record —
 * or a refusal naming the fix when no image to return to is configured.
 */
export function handRunRollback(
  settings: DockerComposeCanarySettings,
): Rollback {
  const topology = topologyOf(settings);
  const vars = variablesOf(settings);
  const stableImage = named(
    settings.stable_,
    `this abort has no record of a rollout of ${topology.stable} — it was ` +
      "run by hand — so it does not know which image to go back to. Add " +
      "d.stable('<image>') to put the stable service back on it, or use " +
      "`zuke cancel <run-id>` for a rollout that is still running.",
  );
  const image = imageOf(stableImage, "the d.stable(...) image");
  return { ...topology, ...vars, stableImage: image, restore: image };
}

/** The state patch that records `rollout`, for `stage`'s one write. */
export function recordOf(rollout: Rollout): Record<string, JsonValue> {
  return {
    [RECORD.stable]: rollout.stable,
    [RECORD.canary]: rollout.canary,
    [RECORD.replicas]: rollout.replicas,
    [RECORD.stableVariable]: rollout.stableVariable,
    [RECORD.canaryVariable]: rollout.canaryVariable,
    [RECORD.candidate]: rollout.candidate,
    [RECORD.stableImage]: rollout.stableImage,
    [RECORD.stableImageId]: rollout.restore,
    [RECORD.scope]: [...rollout.scope],
    [RECORD.projectName]: rollout.projectName,
  };
}

/**
 * The rollout `stage` recorded, validated again — or `undefined` when there is
 * none: no stage ran in this run, or it did not get as far as the record.
 */
export function recordedRollout(
  state: Readonly<Record<string, JsonValue>>,
): Rollout | undefined {
  const stage = state[STAGE];
  if (stage === undefined || stage === "deploying") return undefined;
  const text = (key: string): string => {
    const value = state[key];
    if (typeof value !== "string") throw damaged(key);
    return value;
  };
  const replicas = state[RECORD.replicas];
  if (typeof replicas !== "number") throw damaged(RECORD.replicas);
  const scope = state[RECORD.scope];
  if (
    !Array.isArray(scope) ||
    !scope.every((flag): flag is string => typeof flag === "string")
  ) {
    throw damaged(RECORD.scope);
  }
  const pinned = state[CANDIDATE_ID] === undefined ? undefined : imageIdOf(
    text(CANDIDATE_ID),
    "the recorded candidate image ID",
  );
  return {
    ...(pinned === undefined ? {} : { candidateId: pinned }),
    ...topology(text(RECORD.stable), text(RECORD.canary), replicas),
    ...variables(text(RECORD.stableVariable), text(RECORD.canaryVariable)),
    candidate: imageOf(text(RECORD.candidate), "the recorded candidate"),
    stableImage: imageOf(text(RECORD.stableImage), "the recorded stable image"),
    restore: imageIdOf(
      text(RECORD.stableImageId),
      "the recorded stable image ID",
    ),
    scope,
    projectName: projectNameOf(
      text(RECORD.projectName),
      "the recorded project",
    ),
  };
}

/** `name` if it is a Compose project name, or an error naming `what`. */
export function projectNameOf(name: string, what: string): string {
  if (!PROJECT_SHAPE.test(name)) {
    throw new Error(
      `${CALLER}: ${JSON.stringify(name)} (${what}) is not a Compose ` +
        "project name — lowercase letters, digits, '_' and '-', starting " +
        "with a letter or digit.",
    );
  }
  return name;
}

/** Whether `value` is a full image ID in the `sha256:` form. */
export function isImageId(value: string): boolean {
  return value.startsWith("sha256:") && IMAGE_ID_SHAPE.test(value);
}

/**
 * `value` as a full image ID with its `sha256:` prefix — the form an `image:`
 * accepts — or an error naming `what`.
 */
export function imageIdOf(value: string, what: string): string {
  const hex = IMAGE_ID_SHAPE.exec(value)?.[1];
  if (hex === undefined) {
    throw new Error(
      `${CALLER}: ${JSON.stringify(value)} (${what}) is not a full image ID ` +
        "— 64 hexadecimal digits, optionally after sha256:.",
    );
  }
  return `sha256:${hex}`;
}

/** `reference` if it is an image reference, or an error naming `what`. */
export function imageOf(reference: string, what: string): string {
  if (!IMAGE_SHAPE.test(reference)) {
    throw new Error(
      `${CALLER}: ${JSON.stringify(reference)} (${what}) is not an image ` +
        "reference — it must be non-empty, with no whitespace or control " +
        "characters.",
    );
  }
  return reference;
}

/**
 * The canary replicas for `percent` of `total`: the nearest whole replica,
 * but at least one and leaving at least one stable when the share is
 * strictly between 0 and 100.
 */
export function canaryReplicas(percent: number, total: number): number {
  const nearest = Math.round(total * percent / 100);
  if (percent === 0 || percent === 100) return nearest;
  return Math.min(Math.max(nearest, 1), total - 1);
}

/** Two service names and a replica count, validated. */
function topology(
  stable: string,
  canary: string,
  replicas: number | undefined,
): Topology {
  for (const name of [stable, canary]) {
    if (!SERVICE_SHAPE.test(name)) {
      throw new Error(
        `${CALLER}: "${name}" is not a Compose service name — letters, ` +
          "digits, '_', '.' and '-', not starting with '-'.",
      );
    }
  }
  if (stable === canary) {
    throw new Error(
      `${CALLER}: the stable and canary services are both ${stable} — the ` +
        "canary needs a service of its own.",
    );
  }
  if (replicas === undefined) {
    throw new Error(
      `${CALLER}: no replica count — add d.replicas(4), the replicas the ` +
        "stable and canary services share.",
    );
  }
  if (!Number.isInteger(replicas) || replicas < 2 || replicas > MAX_REPLICAS) {
    throw new Error(
      `${CALLER}: ${replicas} replicas cannot be split between a stable and ` +
        `a canary service — use a whole number from 2 to ${MAX_REPLICAS}.`,
    );
  }
  return { stable, canary, replicas };
}

/** Two variable names, each usable and the two distinct. */
function variables(stableVariable: string, canaryVariable: string): Variables {
  for (const name of [canaryVariable, stableVariable]) {
    if (!VARIABLE_SHAPE.test(name)) {
      throw new Error(
        `${CALLER}: "${name}" is not an environment variable name Compose ` +
          "can interpolate — letters, digits and '_', not starting with a " +
          "digit.",
      );
    }
    if (RESERVED_VARIABLE.test(name)) {
      throw new Error(
        `${CALLER}: ${name} is a setting Docker, Compose or the process ` +
          "itself reads, so setting it to an image would change which " +
          "daemon, file, project or program the command uses. Name the image " +
          "variable something else, such as APP_IMAGE.",
      );
    }
  }
  // Windows reads environment names without regard to case, so APP_IMAGE and
  // app_image are one variable there.
  if (stableVariable.toUpperCase() === canaryVariable.toUpperCase()) {
    throw new Error(
      `${CALLER}: the stable and canary services both read ` +
        `${stableVariable}, so putting the candidate on the canary would put ` +
        "it on the stable service too. Give each service its own variable.",
    );
  }
  return { stableVariable, canaryVariable };
}

/** A required setting, or a friendly error saying what to add. */
function named(value: string | undefined, fix: string): string {
  if (value === undefined) throw new Error(`${CALLER}: ${fix}`);
  return value;
}

/** The error for a record `stage` wrote that no longer reads as one. */
function damaged(key: string): Error {
  return new Error(
    `${CALLER}: this rollout's record has no usable ${key}, so it cannot ` +
      "tell which project, services and images it acts on. Roll back by hand with " +
      "d.stable('<image>').",
  );
}
