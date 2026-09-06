// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Forcing a target's outcome on a live run: `zuke force <run-id> <target>`.
 *
 * An operator sometimes has to take a step off a run — one that cannot succeed,
 * or one a person completed by hand. This records that decision on the run so
 * the executor honours it when it reaches the target, and so the trail says who
 * decided and why.
 *
 * Everything it refuses, it refuses *before* writing: a settled target, a run
 * that has finished, a target the build declared unforceable, or one that is
 * not in the run's graph. The record is the account of what happened, and an
 * override that could rewrite a settled outcome would make that account untrue.
 *
 * @module
 */

import type { Build } from "./build.ts";
import { discoverTargets } from "./build.ts";
import { messageOf } from "./internal.ts";
import { resolveActor } from "./state/record.ts";
import { resolveRunStore } from "./run_store.ts";
import type { StateStore } from "./state/store.ts";
import type {
  ForcedOutcome,
  RunRecord,
  TargetOverride,
} from "./state/types.ts";

/** How many times a losing compare-and-swap is retried before giving up. */
const MAX_RETRIES = 5;

/** Options for {@link forceTarget}. */
export interface ForceOptions {
  /** The run to act on. */
  runId: string;
  /** The dotted target name to force. */
  target: string;
  /** What the target should settle to without running. */
  outcome: ForcedOutcome;
  /** Why — recorded on the override and shown by `zuke runs show`. */
  reason?: string;
  /** Who to attribute the decision to (`--actor`); resolved as for a run. */
  actor?: string;
  /** The durable store the run lives in; resolved as for a run when absent. */
  stateStore?: StateStore | false;
  /** Reads an environment variable (injectable for tests). */
  readEnv?: (name: string) => string | undefined;
}

/**
 * Why a force was refused. Each maps to a message naming the target, so an
 * operator learns which rule stopped them rather than that "it failed".
 */
export type ForceDenial =
  | "unknown_run"
  | "run_terminal"
  | "unknown_target"
  | "already_settled"
  | "unforceable"
  | "write_failed";

/** The result of a {@link forceTarget} call. */
export interface ForceResult {
  /** Whether the override was recorded. */
  ok: boolean;
  /** Why it was refused, when it was. */
  denial?: ForceDenial;
  /** A message naming the target and the rule, suitable for an operator. */
  message: string;
  /** The override as recorded, when it was. */
  override?: TargetOverride;
}

/** Target statuses that mean the target is done and cannot be taken off the plan. */
const SETTLED = new Set(["succeeded", "failed", "skipped"]);

/** Run statuses that mean there is no longer a plan to act on. */
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/** Whether `build` declared `target` off-limits to a force. */
function isUnforceable(build: Build, target: string): boolean {
  return build.unforceable().some((t) => t.name_ === target);
}

/**
 * Everything that can refuse a force, checked against a freshly-read record.
 * Returns the denial, or `null` when the override may be written.
 *
 * Re-run on every compare-and-swap attempt rather than once up front: a
 * conflicting write may be the target settling, and forcing a target that
 * settled while we were deciding is exactly what must not happen.
 */
function denialFor(
  build: Build,
  record: RunRecord,
  target: string,
): { denial: ForceDenial; message: string } | null {
  if (TERMINAL.has(record.status)) {
    return {
      denial: "run_terminal",
      message: `Run ${record.id} is already ${record.status}; ` +
        `there is nothing left to force.`,
    };
  }
  const state = record.targets[target];
  if (state === undefined) {
    return {
      denial: "unknown_target",
      message: `Run ${record.id} has no target "${target}".`,
    };
  }
  if (SETTLED.has(state.status)) {
    return {
      denial: "already_settled",
      message: `Target "${target}" already ${state.status} in run ` +
        `${record.id}. Forcing it would make the record say something that ` +
        `did not happen.`,
    };
  }
  if (isUnforceable(build, target)) {
    return {
      denial: "unforceable",
      message: `Target "${target}" is declared unforceable by this build, ` +
        `so its body must run rather than be settled by hand.`,
    };
  }
  return null;
}

/**
 * Record an operator's forced outcome for one target of a run.
 *
 * The write is a compare-and-swap, retried against a re-read record, so two
 * operators forcing different targets at once cannot lose each other's
 * decision. Every refusal is re-checked on each attempt, because the thing that
 * beat us to the record may be the target settling.
 */
export async function forceTarget(
  build: Build,
  options: ForceOptions,
): Promise<ForceResult> {
  const readEnv = options.readEnv ?? ((name) => Deno.env.get(name));
  const store = resolveRunStore(
    options.stateStore,
    build.stateStore(),
    readEnv,
  );
  if (store === undefined) {
    return {
      ok: false,
      denial: "unknown_run",
      message: "force: no state store is configured. Set ZUKE_STATE_DIR / " +
        "ZUKE_STATE_URL, or override stateStore().",
    };
  }
  // Called for its side effect: target names are recovered by introspecting the
  // instance's fields, so without this a target builder's name is unset and
  // `unforceable()` would match nothing — silently allowing a force the build
  // declared off-limits. The targets themselves come from the record below,
  // which is what the executor will actually read.
  discoverTargets(build);
  const actor = resolveActor(options.actor, readEnv);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const loaded = await store.getRun(options.runId);
    if (loaded === null) {
      return {
        ok: false,
        denial: "unknown_run",
        message: `force: no run ${options.runId} in the store.`,
      };
    }
    const refused = denialFor(build, loaded.record, options.target);
    if (refused !== null) return { ok: false, ...refused };

    const at = new Date().toISOString();
    const override: TargetOverride = {
      outcome: options.outcome,
      actor,
      at,
    };
    if (options.reason !== undefined && options.reason !== "") {
      override.reason = options.reason;
    }
    const next = structuredClone(loaded.record);
    next.overrides = { ...next.overrides, [options.target]: override };
    next.updatedAt = at;

    let result;
    try {
      result = await store.putRun(next, loaded.version);
    } catch (error) {
      return {
        ok: false,
        denial: "write_failed",
        message: `force: could not record the override: ${messageOf(error)}`,
      };
    }
    if (result.ok) {
      const why = override.reason === undefined ? "" : ` (${override.reason})`;
      return {
        ok: true,
        override,
        message: `Forced "${options.target}" to ${options.outcome} in run ` +
          `${options.runId}${why}. It will settle without running when the ` +
          `run next reaches it.`,
      };
    }
    // Someone else wrote first: loop, re-read, and re-check every refusal.
  }
  return {
    ok: false,
    denial: "write_failed",
    message: `force: run ${options.runId} kept changing under us; ` +
      `nothing was recorded. Try again.`,
  };
}
