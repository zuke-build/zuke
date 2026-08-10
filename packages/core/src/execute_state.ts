/**
 * Durable-state plumbing for one run: resolving the {@link StateStore}, opening
 * (or adopting) the {@link RunStateWriter} that records the run and its
 * per-target transitions, and assembling the {@link RunEnv} the schedulers are
 * handed.
 *
 * Keeping this out of {@link "./executor.ts".execute} leaves the executor with
 * the orchestration and this module with the "where does progress get
 * persisted" question.
 *
 * @module
 */

import type { Build } from "./build.ts";
import type { TargetBuilder } from "./target.ts";
import type { Reporter } from "./reporter.ts";
import type { Redactor } from "./redact.ts";
import type { AnyParameter } from "./params.ts";
import type { RunEnv } from "./run_support.ts";
import { absolutePath } from "./path.ts";
import { findConfigDir, pathExists } from "./config.ts";
import { defaultStateHost, type StateStore } from "./state/store.ts";
import { resolveStateStore } from "./state/resolve.ts";
import { buildRunRecord, ciRunUrl, resolveActor } from "./state/record.ts";
import { RunStateWriter } from "./state/writer.ts";
import type {
  RunRecord,
  SignalRecord,
  TargetRunStatus,
  WaitState,
} from "./state/types.ts";
import type { ResumeState } from "./executor.ts";

/**
 * The still-waiting targets of a resumed run, mapped to the {@link WaitState}
 * they last recorded — the source of the original timeout deadline that a
 * re-suspend must preserve (see {@link RunEnv.priorWaits}).
 */
function priorWaitsOf(record: RunRecord): ReadonlyMap<string, WaitState> {
  const waits = new Map<string, WaitState>();
  for (const [name, state] of Object.entries(record.targets)) {
    if (state.waitingFor !== undefined) waits.set(name, state.waitingFor);
  }
  return waits;
}

/**
 * The outcomes a resumed run inherits — what an earlier process settled, as
 * `ctx.outcomeOf(...)` should report it (see {@link RunEnv.statuses}).
 *
 * A fresh run starts empty. `pending` rows are left out: a target that has not
 * run has no outcome, and reporting one would make a body branch on a target
 * that is about to run in this very process.
 */
function priorStatusesOf(record: RunRecord | undefined): Map<
  string,
  TargetRunStatus
> {
  const statuses = new Map<string, TargetRunStatus>();
  if (record === undefined) return statuses;
  for (const [name, state] of Object.entries(record.targets)) {
    if (state.status !== "pending") statuses.set(name, state.status);
  }
  return statuses;
}

/** Durable-state plumbing for one run: the writer and the RunEnv. */
export interface RunState {
  /** The writer recording transitions, or `undefined` without a store. */
  writer?: RunStateWriter;
  /** The environment handed to the scheduler. */
  env: RunEnv;
}

/**
 * Resolve the durable state store, open (or adopt) the run's writer, and
 * assemble the {@link RunEnv}. Returns the error instead of throwing when a
 * target needs state that is disabled.
 */
export async function openRunState(opts: {
  build: Build;
  root: TargetBuilder;
  order: TargetBuilder[];
  /**
   * The run's resolved parameters, copied into the record. An array rather than
   * an `Iterable` on purpose: a `MapIterator` is one-shot, so a second read
   * inside this function would silently see an empty list.
   */
  params: readonly AnyParameter[];
  runId: string;
  dryRun: boolean;
  signal: AbortSignal;
  redactor: Redactor;
  reporter: Reporter;
  readEnv: (name: string) => string | undefined;
  nowIso: () => string;
  onExternalCancel: () => void;
  stateStore?: StateStore | false;
  state?: boolean;
  actor?: string;
  resume?: ResumeState;
  artifactDir: string;
}): Promise<{ ok: true; state: RunState } | { ok: false; error: Error }> {
  const { dryRun, order, readEnv, nowIso, redactor, resume } = opts;
  // Resolve the durable state store (if any) and open a writer that records the
  // run and its per-target transitions. Never for a dry run — no body executes,
  // so there is no run to persist. State writes are best-effort: a store hiccup
  // is reported, never fatal (see RunStateWriter).
  // A build that uses a durable feature (a cross-run lock; later, waits and
  // compensations) turns the filesystem store on by default, so state "just
  // works" without --state. Plain builds still opt in explicitly.
  const usesDurableFeature = order.some((t) =>
    t.lock_ !== undefined || t.waitsFor_ !== undefined ||
    t.onCancel_ !== undefined
  );
  const stateStore = dryRun ? undefined : resolveStateStore(
    opts.stateStore,
    opts.build.stateStore(),
    {
      readEnv,
      host: defaultStateHost,
      defaultDir: absolutePath(
        findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd(),
      )(opts.artifactDir, "runs").path,
      enableDefault: (opts.state ?? false) || usesDurableFeature,
    },
  );
  // A wait needs somewhere to persist the suspension; without a store it could
  // never be resumed. Fail fast with guidance instead of suspending into the
  // void. (enableDefault turns the FS store on for waits, so this only triggers
  // when state was explicitly disabled.)
  if (
    !dryRun && stateStore === undefined &&
    order.some((t) => t.waitsFor_ !== undefined)
  ) {
    const error = new Error(
      "A target uses .waitsFor(...), which needs a state store to persist the " +
        "suspended run — but state is disabled. Enable it (drop stateStore: " +
        "false, pass --state, or set ZUKE_STATE_DIR / ZUKE_STATE_URL).",
    );
    return { ok: false, error };
  }
  const actor = resolveActor(opts.actor, readEnv);
  const runUrl = ciRunUrl(readEnv);
  const warn = (message: string) => opts.reporter.info(message);
  const writer = stateStore === undefined ? undefined : resume !== undefined
    // A resume continues the existing record (already transitioned to running).
    ? RunStateWriter.adopt(
      stateStore,
      resume.record,
      resume.version,
      nowIso,
      redactor,
      warn,
      opts.onExternalCancel,
    )
    : await RunStateWriter.open(
      stateStore,
      buildRunRecord({
        runId: opts.runId,
        build: opts.build.constructor.name,
        rootTarget: opts.root.name_ ?? "<unnamed>",
        actor,
        now: nowIso(),
        order,
        params: opts.params,
      }),
      nowIso,
      redactor,
      warn,
      opts.onExternalCancel,
    );
  const env: RunEnv = {
    runId: opts.runId,
    signal: opts.signal,
    writer,
    store: stateStore,
    actor,
    runUrl,
    signals: writer ? writer.signals() : new Map<string, SignalRecord>(),
    // Seeded from the record so a resumed run's targets keep the outcomes an
    // earlier process settled, rather than reading as though they never ran.
    statuses: priorStatusesOf(resume?.record),
    done: resume?.done,
    priorWaits: resume ? priorWaitsOf(resume.record) : undefined,
  };
  return { ok: true, state: { writer, env } };
}
