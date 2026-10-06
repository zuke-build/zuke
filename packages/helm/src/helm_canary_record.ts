// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What `helmCanary` records in the rollout's durable state: how far `stage`
 * got, the stable release's revision before the rollout, and the candidate
 * `stage` installed — so every later call, in this process or a resumed one,
 * renders what was analysed rather than a configuration that may have changed
 * since. Internal to the package: not exported from `mod.ts`.
 *
 * @module
 */

import type { JsonValue } from "@zuke/core";
import { type Candidate, checkedCandidate } from "./helm_canary_checks.ts";

/** The state key recording how far `stage` got. */
export const STAGE = "helmStage";

/** The state key the stable release's pre-rollout revision is recorded under. */
export const STABLE_REVISION = "helmStableRevision";

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
  return checkedCandidate({
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
