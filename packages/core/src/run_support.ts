// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Shared value types for the execution engine — the per-run environment and the
 * per-target/-run outcome shapes threaded between the scheduler, lock, and wait
 * modules. Kept in a leaf module — its only value import is the equally
 * dependency-free `internal.ts` — so those modules can all import it without
 * forming a cycle.
 *
 * @module
 */

import { messageOf } from "./internal.ts";
import type { TargetStatus } from "./build.ts";
import type { TargetOutcomeView } from "./target.ts";
import type { TargetReport } from "./report.ts";
import type { RunStateWriter } from "./state/writer.ts";
import type { StateStore } from "./state/store.ts";
import type {
  SignalRecord,
  TargetRunState,
  TargetRunStatus,
  WaitState,
} from "./state/types.ts";

/** What running one target produced, fed back to the scheduler and summary. */
export interface TargetOutcome {
  /** The target's terminal status. */
  status: TargetStatus;
  /** Wall-clock duration of the body, in milliseconds. */
  ms: number;
  /** The failure, when `status` is `"failed"`. */
  error?: unknown;
  /**
   * For a `.forEach(...)` fan-out target, the reports of its materialised
   * sub-targets, surfaced into the build summary and run record beneath the
   * parent row. Undefined for an ordinary target.
   */
  children?: TargetReport[];
}

/** What a run (sequential or parallel) produced, fed into the shared summary. */
export interface RunOutcome {
  /** One report per planned target, in declaration order. */
  reports: TargetReport[];
  /** The names of the targets whose bodies actually ran and passed. */
  executed: string[];
  /** The first failure, if any. */
  failure: unknown;
  /** Whether the run was aborted (a non-lenient failure occurred). */
  aborted: boolean;
  /** True when the run parked at a `.waitsFor(...)` gate rather than finishing. */
  suspended: boolean;
}

/**
 * Per-run values threaded to the schedulers and each target: the run id, the
 * cancellation signal handed to every `TargetContext`, and the optional
 * durable-state writer that records transitions.
 */
export interface RunEnv {
  /** The run's stable identity (across a resume). */
  runId: string;
  /** The cancellation signal handed to every target context. */
  signal: AbortSignal;
  /** The durable-state writer that records transitions, if any. */
  writer?: RunStateWriter;
  /** The resolved state store, if any — needed to acquire cross-run locks. */
  store?: StateStore;
  /** The run's actor, stamped on a lock holder. */
  actor: string;
  /** A link to this run (CI job), stamped on a lock holder when known. */
  runUrl?: string;
  /** External signals received so far, exposed to bodies via `ctx.signals`. */
  signals: ReadonlyMap<string, SignalRecord>;
  /**
   * What settled in **this** process, in the record's vocabulary — what
   * `ctx.outcomeOf(...)` reads first.
   *
   * The durable record is not enough on its own. Every `markTargetSettled` is
   * fire-and-forget through the writer's serialized chain, so a target that has
   * just failed can still read `running` in the record for as long as that
   * write is queued. A gate aggregating outcomes would then see a green run.
   * This map is written synchronously as each target settles, so it cannot lag
   * behind the thing it describes; the record backfills what a *previous*
   * process settled.
   *
   * It carries the failure message as well as the status, so a run with no
   * state store — where there is no record to fall back to — still reports
   * *why* a target failed and not merely that it did.
   */
  statuses: Map<string, TargetSettlement>;
  /** On a resume, target names already succeeded — seeded done, never re-run. */
  done?: ReadonlySet<string>;
  /**
   * On a resume, each still-waiting target's previously recorded {@link WaitState}
   * — so a re-suspend preserves the original timeout deadline instead of
   * recomputing `now + timeout` (which would push it forward on every
   * `resume --check` and mean the timeout never fires).
   */
  priorWaits?: ReadonlyMap<string, WaitState>;
}

/** What a target settled to in this process: its status and, if it failed, why. */
export interface TargetSettlement {
  /** The status, in the run record's vocabulary. */
  status: TargetRunStatus;
  /** The failure's message, when it failed. */
  error?: string;
}

/**
 * Build the caller-facing outcome view from a settlement and the record row it
 * came with, if there is one.
 *
 * `status` wins over `row.status` deliberately: the row is the durable copy and
 * can be a write behind, while the status passed here is whatever the caller
 * established is current.
 */
export function outcomeView(
  settled: TargetSettlement,
  row: TargetRunState | undefined,
): TargetOutcomeView {
  const error = settled.error ?? row?.error;
  return {
    status: settled.status,
    ...(error === undefined ? {} : { error }),
    ...(row?.startedAt === undefined ? {} : { startedAt: row.startedAt }),
    ...(row?.endedAt === undefined ? {} : { endedAt: row.endedAt }),
  };
}

/**
 * Every settled outcome a run record holds, keyed by target name.
 *
 * `pending` rows are omitted: a target that has not run has no outcome, and an
 * entry saying otherwise would invite a body to branch on it.
 */
export function outcomesFromRecord(
  targets: Readonly<Record<string, TargetRunState>>,
): Map<string, TargetOutcomeView> {
  const all = new Map<string, TargetOutcomeView>();
  for (const [name, row] of Object.entries(targets)) {
    if (row.status === "pending") continue;
    all.set(name, outcomeView({ status: row.status }, row));
  }
  return all;
}

/** A failure's message, or `undefined` when there was none — for the state record. */
export function errorMessage(error: unknown): string | undefined {
  // The guard stays: `messageOf(undefined)` is the string `"undefined"`.
  return error === undefined ? undefined : messageOf(error);
}
