// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What `helmCanary` records in the rollout's durable state: how far `stage`
 * got, the releases and namespace it acts on, the stable release's revision
 * before the rollout, and the candidate `stage` installed — so every later call, in this process or a resumed one,
 * renders what was analysed rather than a configuration that may have changed
 * since. Internal to the package: not exported from `mod.ts`.
 *
 * @module
 */

import type { JsonValue } from "@zuke/core";
import { type Candidate, recheckedCandidate } from "./helm_canary_candidate.ts";
import type { ReleaseNames } from "./helm_canary_checks.ts";

/** The state key recording how far `stage` got. */
export const STAGE = "helmStage";

/** The state key the stable release's pre-rollout revision is recorded under. */
export const STABLE_REVISION = "helmStableRevision";

/**
 * The state keys the rollout's identity is recorded under — its releases
 * and namespace, with the human name each is reported by.
 */
const IDENTITY: ReadonlyArray<
  readonly [
    key: string,
    label: string,
    of: (names: ReleaseNames) => string | null,
  ]
> = [
  ["helmStableRelease", "stable release", (names) => names.stable],
  ["helmCanaryRelease", "canary release", (names) => names.canary],
  ["helmNamespace", "namespace", (names) => names.namespace ?? null],
];

/** The state patch recording the releases and namespace a rollout acts on. */
export function identityRecord(names: ReleaseNames): Record<string, JsonValue> {
  return Object.fromEntries(IDENTITY.map(([key, , of]) => [key, of(names)]));
}

/**
 * Refuse unless `names` are the releases and namespace this rollout recorded.
 * A resumed process configured differently must not act on either set: the
 * configured names would leave the recorded canary release behind, and the
 * recorded ones would be used with a kube context the record cannot hold.
 */
export function checkIdentity(
  recorded: Record<string, JsonValue>,
  names: ReleaseNames,
): void {
  for (const [key, label, of] of IDENTITY) {
    const was = recorded[key];
    const now = of(names);
    if (was === undefined) {
      throw new Error(
        `helmCanary: the rollout's record is damaged: it does not name the ` +
          `${label} it started with, so this call cannot tell which releases ` +
          "are the rollout's. Check `helm list` and clean up by hand.",
      );
    }
    if (was !== now) {
      throw new Error(
        `helmCanary: this rollout started with the ${label} ` +
          `${shown(was)}, but it is now configured with ${shown(now)}. ` +
          "Finish or cancel the rollout with the configuration it started " +
          "with — including the kube context in h.helm(...), which the record " +
          "cannot hold — then change it.",
      );
    }
  }
}

/** A recorded or configured identity value, for a message. */
function shown(value: JsonValue): string {
  return value === null ? "helm's default" : JSON.stringify(value);
}

/** The state keys the staged candidate's parts are recorded under. */
const KEYS = {
  image: "helmImage",
  total: "helmReplicas",
  chart: "helmChart",
  version: "helmVersion",
  stableChart: "helmStableChart",
  stableVersion: "helmStableVersion",
  values: "helmValues",
  imageKey: "helmImageKey",
  replicasKey: "helmReplicasKey",
};

/** The state patch recording `candidate` as the one staged. */
export function candidateRecord(
  candidate: Candidate,
): Record<string, JsonValue> {
  return {
    [KEYS.image]: candidate.image,
    [KEYS.total]: candidate.total,
    [KEYS.chart]: candidate.chart,
    [KEYS.version]: candidate.version ?? null,
    [KEYS.stableChart]: candidate.stableChart,
    [KEYS.stableVersion]: candidate.stableVersion ?? null,
    [KEYS.values]: [...candidate.values],
    [KEYS.imageKey]: candidate.imageKey,
    [KEYS.replicasKey]: candidate.replicasKey,
  };
}

/** The candidate `stage` recorded, checked again as a configured one is. */
export function recordedCandidate(
  recorded: Record<string, JsonValue>,
): Candidate {
  const image = recorded[KEYS.image];
  const total = recorded[KEYS.total];
  const chart = recorded[KEYS.chart];
  const version = recorded[KEYS.version];
  const stableChart = recorded[KEYS.stableChart];
  const stableVersion = recorded[KEYS.stableVersion];
  const values = recorded[KEYS.values];
  const imageKey = recorded[KEYS.imageKey];
  const replicasKey = recorded[KEYS.replicasKey];
  if (
    typeof image !== "string" || typeof total !== "number" ||
    typeof chart !== "string" || !isStringOrNull(version) ||
    typeof stableChart !== "string" || !isStringOrNull(stableVersion) ||
    !isStringArray(values) || typeof imageKey !== "string" ||
    typeof replicasKey !== "string"
  ) {
    throw new Error(
      "helmCanary: the rollout's record of the staged candidate is " +
        "incomplete, so this call cannot know what was analysed. Roll the " +
        "rollout back and stage it again.",
    );
  }
  return recheckedCandidate({
    chart,
    version: version ?? undefined,
    stableChart,
    stableVersion: stableVersion ?? undefined,
    values,
    imageKey,
    replicasKey,
    image,
    total,
  });
}

/** Whether a recorded value is a string, or `null` for "not set". */
function isStringOrNull(value: JsonValue | undefined): value is string | null {
  return value === null || typeof value === "string";
}

/** Whether a recorded value is a list of strings. */
function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}
