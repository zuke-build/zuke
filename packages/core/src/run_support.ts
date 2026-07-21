/**
 * Shared value types for the execution engine — the per-run environment and the
 * per-target/-run outcome shapes threaded between the scheduler, lock, and wait
 * modules. Kept in a dependency-free leaf module so those modules can all import
 * it without forming a cycle.
 *
 * @module
 */

import type { TargetStatus } from "./build.ts";
import type { TargetReport } from "./report.ts";
import type { RunStateWriter } from "./state/writer.ts";
import type { StateStore } from "./state/store.ts";
import type { SignalRecord, WaitState } from "./state/types.ts";

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

/** A failure's message, or `undefined` when there was none — for the state record. */
export function errorMessage(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  return error instanceof Error ? error.message : String(error);
}
