// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What `helmCanary` records in the rollout's durable state: how far `stage`
 * got, the releases and namespace it acts on, the stable release's revision
 * before the rollout and when that release was first deployed, and the
 * candidate `stage` installed — so every later call, in this process or a
 * resumed one, renders what was analysed rather than a configuration that may
 * have changed since, and acts only on the stable release the rollout started
 * with. Internal to the package: not exported from `mod.ts`.
 *
 * @module
 */

import type { JsonValue } from "@zuke/core";
import { type Candidate, recheckedCandidate } from "./helm_canary_candidate.ts";
import type { ReleaseNames } from "./helm_canary_checks.ts";
import { isWholeNumber } from "./whole_number.ts";

/** The state key recording how far `stage` got. */
export const STAGE = "helmStage";

/** The state key the stable release's pre-rollout revision is recorded under. */
export const STABLE_REVISION = "helmStableRevision";

/**
 * The state key the stable release's first-deployed time is recorded under:
 * nanoseconds since 1970 as a string of digits. A string, because the value
 * (about 1.8e18) is beyond what a JSON number holds exactly.
 */
export const STABLE_FIRST_DEPLOYED = "helmStableFirstDeployed";

/**
 * A first-deployed time as helm's `UnixNano` prints it: digits, at most 19 of
 * them (an int64), so it is always a time a `Date` can show.
 */
export const FIRST_DEPLOYED_SHAPE = /^[0-9]{1,19}$/;

/**
 * The state keys the rollout's identity is recorded under — its releases
 * and namespace — with the human name each is reported by, how it is read
 * from configuration, and whether `null` (helm's default) is a value it can
 * take.
 */
const IDENTITY: ReadonlyArray<
  readonly [
    key: string,
    label: string,
    of: (names: ReleaseNames) => string | null,
    nullable: boolean,
  ]
> = [
  ["helmStableRelease", "stable release", (names) => names.stable, false],
  ["helmCanaryRelease", "canary release", (names) => names.canary, false],
  ["helmNamespace", "namespace", (names) => names.namespace ?? null, true],
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
 * The refusal spells out the one recovery that works from there: the
 * configuration set back, and the rollback run by hand.
 */
export function checkIdentity(
  recorded: Record<string, JsonValue>,
  names: ReleaseNames,
): void {
  const was = IDENTITY.map(([key, label, , nullable]) => {
    const value = recorded[key];
    if (typeof value === "string" || (nullable && value === null)) {
      return value;
    }
    throw new Error(
      `helmCanary: the rollout's record is damaged: it does not name the ` +
        `${label} it started with (it holds ${JSON.stringify(value)}), so ` +
        "this call cannot tell which releases are the rollout's. Check " +
        "`helm list` and clean up by hand.",
    );
  });
  IDENTITY.forEach(([, label, of], index) => {
    const now = of(names);
    if (was[index] !== now) {
      throw new Error(
        `helmCanary: this rollout started with the ${label} ` +
          `${shown(was[index])}, but it is now configured with ` +
          `${shown(now)}, so this call changes nothing rather than act on ` +
          "either: the kube context in h.helm(...) is not recorded, so the " +
          "recorded names cannot be trusted with the current one. To " +
          "recover, set the configuration back to what the rollout started " +
          "with, then run the rollout's <field>.abort target by hand (for " +
          `example \`zuke rollout.abort\`) with ${
            recovery(recorded, was[0])
          }. It rolls the stable release back and removes the canary release.`,
      );
    }
  });
}

/**
 * The stable release's first-deployed time this rollout recorded, refused as
 * a damaged record unless it is a string of digits — never converted to a
 * number, which would round it.
 */
export function recordedFirstDeployed(
  recorded: Record<string, JsonValue>,
  stable: string,
): string {
  const value = recorded[STABLE_FIRST_DEPLOYED];
  if (typeof value === "string" && FIRST_DEPLOYED_SHAPE.test(value)) {
    return value;
  }
  throw new Error(
    `helmCanary: the rollout's record is damaged: it does not hold when the ` +
      `stable release ${stable} was first deployed (it holds ` +
      `${JSON.stringify(value)}), so this call cannot tell that ${stable} is ` +
      "still the release the rollout started with. Check `helm history " +
      `${stable}\` and \`helm list\` and clean up by hand.`,
  );
}

/**
 * Refuse unless the stable release was first deployed at `recorded`, the time
 * `stage` read. Helm sets a release's first-deployed time once, at install,
 * and every upgrade and rollback carries it forward, so a different one means
 * another incarnation of the release — uninstalled and installed again — or
 * another cluster's release of the same name, reached through a kube context
 * that changed. Rolling either back to the recorded revision, or upgrading
 * it, would act on a deployment this rollout never staged. `state` is the
 * rollout's record, which the refusal reads for the revision a hand-run
 * recovery needs.
 */
export function checkFirstDeployed(
  stable: string,
  recorded: string,
  live: string,
  state: Record<string, JsonValue>,
): void {
  if (recorded === live) return;
  throw new Error(
    `helmCanary: the stable release ${stable} was first deployed at ` +
      `${isoTime(recorded)} when this rollout started, but the release helm ` +
      `reaches now was first deployed at ${isoTime(live)}: it was ` +
      "reinstalled, or the kube context in h.helm(...) points at another " +
      "cluster. This call changed nothing, and the run is left cancelled " +
      "with the canary release in place, so a resume or `zuke cancel` will " +
      "not roll it back. To recover, point the kube context back at the " +
      `cluster the rollout started on, check with \`helm status ${stable}\` ` +
      "that it reaches the release that was staged (a rollback run by hand " +
      "has no record to check it against), then run the rollout's " +
      "<field>.abort target by hand (for example `zuke rollout.abort`) with " +
      `${recovery(state, stable)}. If the release really was reinstalled, ` +
      "the recorded revision is not in its history: check `helm history " +
      `${stable}\` and clean up by hand, uninstalling the canary release ` +
      "once the stable one is as it should be.",
  );
}

/** A first-deployed time in nanoseconds since 1970, as ISO 8601. */
function isoTime(nanos: string): string {
  return new Date(Number(BigInt(nanos) / 1_000_000n)).toISOString();
}

/** The `h.stableRevision(...)` a hand-run rollback needs, as advice. */
function recovery(
  recorded: Record<string, JsonValue>,
  stable: string | null,
): string {
  const revision = recorded[STABLE_REVISION];
  return typeof revision === "number" && isWholeNumber(revision)
    ? `h.stableRevision(${revision}), the revision it recorded`
    : "h.stableRevision(<n>) set to the pre-rollout revision `helm history " +
      `${stable}\` lists`;
}

/** A recorded or configured identity value, for a message. */
function shown(value: string | null): string {
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
