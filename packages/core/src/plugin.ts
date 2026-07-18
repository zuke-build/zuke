/**
 * The plugin contract: observe a build's lifecycle without subclassing
 * {@link Build} or forking Zuke.
 *
 * A {@link Plugin} is a plain object with optional async hooks. Register one (or
 * several) by passing them to {@link run} or {@link execute}; every hook a
 * plugin implements is invoked alongside the build's own lifecycle methods, in
 * registration order. Plugins observe — they report, time, or notify — they do
 * not alter the plan or a target's result.
 *
 * ```ts
 * import { type Plugin, run } from "jsr:@zuke/core";
 *
 * const timing: Plugin = {
 *   name: "timing",
 *   // The enriched form carries the run id and the target's duration…
 *   onTargetEnd: (target, status, timing) =>
 *     console.log(`${timing.runId} ${target}: ${status} in ${timing.durationMs}ms`),
 * };
 *
 * await run(MyBuild, { plugins: [timing] });
 * ```
 *
 * Every hook's extra arguments are additive: a plugin written against the old
 * signatures (`onTargetEnd: (target, status) => …`) keeps working unchanged,
 * because a function that ignores the trailing arguments is still assignable.
 *
 * @module
 */

import type { BuildResult, TargetStatus } from "./build.ts";
import type { RunRecord } from "./state/types.ts";

/**
 * Run identity passed to a plugin's lifecycle hooks, so an observer can group a
 * run's events (e.g. under one trace id) — stable across a suspend/resume
 * boundary, since a resumed run keeps the original id.
 */
export interface RunInfo {
  /** The run id, stable for every target in the run (and across a resume). */
  readonly runId: string;
  /** True when the run is a dry run (no target body executes). */
  readonly dryRun: boolean;
}

/** Timing for a settled target, passed to {@link Plugin.onTargetEnd}. */
export interface TargetTiming {
  /** The run id (see {@link RunInfo}). */
  readonly runId: string;
  /** The target's wall-clock duration in milliseconds (0 for skipped/cached). */
  readonly durationMs: number;
}

/**
 * A lifecycle observer. Every hook is optional; implement only the ones you
 * need. Hooks may be async — the executor awaits each before continuing.
 */
export interface Plugin {
  /** A name for diagnostics (optional). */
  name?: string;
  /** Called once before any target runs, with the run's {@link RunInfo}. */
  onStart?(run: RunInfo): void | Promise<void>;
  /**
   * Called just before a target's body executes (not for skipped/cached), with
   * the target name and the run's {@link RunInfo}.
   */
  onTargetStart?(target: string, run: RunInfo): void | Promise<void>;
  /**
   * Called after each target settles, with its final status and its
   * {@link TargetTiming} (run id + duration).
   */
  onTargetEnd?(
    target: string,
    status: TargetStatus,
    timing: TargetTiming,
  ): void | Promise<void>;
  /**
   * Called once after the run completes (success or failure), with the result
   * and the run's {@link RunInfo}.
   */
  onFinish?(result: BuildResult, run: RunInfo): void | Promise<void>;
  /**
   * Called on each **run-level** durable status change — the run going
   * `running`, `suspended`, `succeeded`, `failed`, `cancelling`, or `cancelled`
   * — with the current {@link "./state/types.ts".RunRecord}. It carries the full
   * record (per-target timings, waits, the audit trail), so a metrics exporter
   * can derive spans, wait durations, and counters from a single source.
   * **Only fires when a state store is configured** (the record's home); a plain
   * build with no store never produces one, and this hook stays silent.
   *
   * A run cancelled in-process (Ctrl-C / its `signal`) is observed as
   * `running` → `cancelling` → `cancelled`. When **another process** cancels the
   * run (`zuke cancel`), this process observes it through `cancelling` and stops
   * — the canceller's process owns the final `cancelled` — so treat `cancelling`
   * as run-ended for the owning process.
   */
  onRunStateChange?(record: RunRecord): void | Promise<void>;
}
