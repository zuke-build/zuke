/**
 * Reaping: finding runs whose process is gone, and giving them somewhere to go.
 *
 * A run that ends cleanly settles itself, and a run that suspends is picked up
 * by the ordinary resume sweep. A run whose process was *killed* does neither —
 * it stays `running` forever, and nothing in zuke looks at `running` runs. Any
 * work it had recorded as owed, an effect above all, waits for a resume that
 * will never come, because a resume only acts on `suspended`.
 *
 * This closes that. Before the suspended sweep runs, every `running` run of this
 * build is examined, and the first question is always whether anyone is still
 * there:
 *
 * - **Is anyone still there?** The run's lease answers it. A live holder keeps
 *   renewing, so a lease that can be acquired means the holder is gone; one that
 *   cannot means the run is merely slow, and slow is not dead — it is left
 *   alone, deadline or no deadline.
 * - **Nobody there, and past its deadline** — settled `failed`, compensations and
 *   all. A run that has run out of time has an answer, and anything waiting on
 *   it needs one.
 * - **Nobody there** — the run moves back to `suspended`, which is the state the
 *   existing resume machinery already knows how to drive. The sweep then resumes
 *   it on the same pass, re-driving whatever it was owed.
 *
 * A run stranded `cancelling` by a settlement whose process died is finished
 * too, in whichever terminal that settlement was heading for.
 *
 * @module
 */

import { type Build, discoverTargets } from "./build.ts";
import type { Reporter } from "./executor.ts";
import { messageOf } from "./internal.ts";
import { settleExternally } from "./cancel.ts";
import { acquireLease, RUN_LEASE_PREFIX } from "./state/run_lease.ts";
import type { StateStore } from "./state/store.ts";
import { planGraph } from "./graph.ts";
import type { RunEvent, RunGraphNode, RunRecord } from "./state/types.ts";

/** How many times a conflicting reap CAS is re-read and retried. */
const MAX_RETRIES = 10;

/** What one reaping pass did, folded into the sweep's own counts. */
export interface ReapOutcome {
  /** Runs moved back to `suspended` for the resume sweep to pick up. */
  reaped: string[];
  /** Runs settled terminally — past their deadline, or stranded mid-settlement. */
  settled: string[];
  /** Runs that errored while being examined; each is reported, none abort the pass. */
  failed: number;
}

/** Everything a reaping pass needs, so the sweep can hand it its own plumbing. */
export interface ReapDeps {
  /** The build the runs belong to — needed to compensate a settled one. */
  build: Build;
  /** The store the runs live in. */
  store: StateStore;
  /** Who to record as having done the reaping. */
  actor: string;
  /** Where the pass narrates what it did. */
  reporter: Reporter;
  /** The current time, as an ISO-8601 string. */
  now: () => string;
  /** Examine only this run, rather than every `running` one. */
  runId?: string;
  /** Suppress the settlement's own output. */
  silent?: boolean;
}

/**
 * Examine the runs that claim to be running, and settle or release the ones
 * whose process is gone.
 *
 * Never throws for a single run: one bad record must not strand every run
 * behind it, exactly as in the sweep this is called from.
 */
export async function reapAbandoned(deps: ReapDeps): Promise<ReapOutcome> {
  const { store, reporter } = deps;
  const outcome: ReapOutcome = { reaped: [], settled: [], failed: 0 };

  const ids = deps.runId !== undefined
    ? [deps.runId]
    : (await store.listRuns({ status: "running" })).map((s) => s.id);

  for (const id of ids) {
    try {
      const examined = await examine(id, deps);
      if (examined === "reaped") outcome.reaped.push(id);
      else if (examined === "settled") outcome.settled.push(id);
    } catch (error) {
      outcome.failed += 1;
      reporter.error(`reap: run ${id} errored: ${messageOf(error)}`);
    }
  }
  return outcome;
}

/**
 * Finish runs left `cancelling` by a settlement whose process died.
 *
 * The settlement lock's TTL is what makes this safe: a live settler still holds
 * it, so `settleExternally` refuses and this is a no-op; a dead one's lock has
 * lapsed, and the recovery path finalises the record without re-running
 * compensations that may not be idempotent.
 */
export async function recoverStranded(deps: ReapDeps): Promise<ReapOutcome> {
  const { store, reporter } = deps;
  const outcome: ReapOutcome = { reaped: [], settled: [], failed: 0 };
  const ids = deps.runId !== undefined
    ? [deps.runId]
    : (await store.listRuns({ status: "cancelling" })).map((s) => s.id);
  for (const id of ids) {
    try {
      const loaded = await store.getRun(id);
      if (loaded === null || loaded.record.status !== "cancelling") continue;
      // The strict question, because this settles: a run whose graph this build
      // does not recognise is left for the build that does.
      if (!canSettle(loaded.record, deps)) continue;
      // The terminal named here is only a default: a record that says which
      // settlement it was in the middle of wins, since this process is not the
      // one that started it.
      const result = await settleExternally(deps.build, {
        runId: id,
        stateStore: store,
        actor: deps.actor,
        silent: deps.silent,
        reporter: deps.reporter,
        terminal: "cancelled",
      });
      if (!result.noop) outcome.settled.push(id);
    } catch (error) {
      outcome.failed += 1;
      reporter.error(`reap: stranded run ${id} errored: ${messageOf(error)}`);
    }
  }
  return outcome;
}

/** What examining one running run concluded. */
type Examined = "reaped" | "settled" | "alive";

/** Decide what to do about one run that claims to be running, and do it. */
async function examine(id: string, deps: ReapDeps): Promise<Examined> {
  const loaded = await deps.store.getRun(id);
  if (loaded === null || loaded.record.status !== "running") return "alive";
  if (!belongsToBuild(loaded.record, deps)) return "alive";

  // Is anyone still working on it? The lease answers it, and acquiring is the
  // question: a live holder is renewing, so a lease that cannot be taken means
  // the run is merely slow. Slow is not dead.
  //
  // This comes first, before the deadline, and that ordering is the whole
  // safety of the thing. Settling a run whose process is still working would
  // run its compensations *beside* the work they undo, and leave a live process
  // reporting on a run somebody else had ended. Every case a deadline is for —
  // a hung process whose heartbeat has starved, a run killed and abandoned over
  // and over — has no live holder, so nothing the deadline exists to catch
  // escapes by checking this first. A genuinely live run that outlasts its
  // deadline is left alone until whatever is running it stops.
  const lease = await acquireLease(
    deps.store,
    RUN_LEASE_PREFIX,
    id,
    deps.actor,
    deps.now,
  );
  if (lease === null) return "alive";

  try {
    // Re-read under the lease: between listing and acquiring, the run may have
    // been settled or picked up, and acting on the older view would undo that.
    const held = await deps.store.getRun(id);
    if (held === null || held.record.status !== "running") return "alive";

    if (pastDeadline(held.record, deps.now()) && canSettle(held.record, deps)) {
      // Settled rather than released: a run that has run out of time is not one
      // to hand back for another attempt. Its compensations still run, because
      // an abandoned run's side effects need unwinding just as much as a
      // cancelled one's.
      deps.reporter.info(
        `reap: run ${id} passed its deadline (${held.record.deadlineAt}) — ` +
          `settling it failed.`,
      );
      await settleExternally(deps.build, {
        runId: id,
        stateStore: deps.store,
        actor: deps.actor,
        silent: deps.silent,
        reporter: deps.reporter,
        terminal: "failed",
      });
      return "settled";
    }

    const moved = await toSuspended(id, deps);
    if (!moved) return "alive";
    deps.reporter.info(
      `reap: run ${id} was left running by a process that is gone — ` +
        `returning it to suspended so it can be resumed.`,
    );
    return "reaped";
  } finally {
    // Released either way: this pass is not the one that will drive the run, and
    // holding the claim would make the resumer that follows refuse it.
    await lease.release();
  }
}

/**
 * Whether this sweep is entitled to touch `record`.
 *
 * A state store is commonly shared across builds, and a listing has no build
 * filter — so a sweep sees every build's runs, not just its own. Acting on
 * another build's run is worse than useless: its targets are not in this build,
 * so a settlement would find no compensations to run and would stamp the record
 * terminal with the run's side effects never unwound, and nothing would retry it
 * because the record is no longer live. The suspended sweep is safe here only
 * because a resume *refuses* a build it cannot match; a reap mutates, so it has
 * to check.
 *
 * Two things are checked, because a class name is not an identity. `Ci` is a
 * name half the repos in an organisation will use, and a run record carries
 * nothing more specific, so the name alone would let one repo's sweep settle
 * another's runs. Requiring the record's root target to exist here as well is
 * what makes a collision harmless in practice: the compensations a settlement
 * runs are resolved by name, so a build that has the run's root target has the
 * targets that run recorded.
 *
 * Two builds that share a class name *and* a root-target name are still
 * indistinguishable to this, which is why the destructive path asks
 * {@link canSettle} as well.
 */
function belongsToBuild(record: RunRecord, deps: ReapDeps): boolean {
  if (record.build !== deps.build.constructor.name) return false;
  return discoverTargets(deps.build).has(record.rootTarget);
}

/**
 * Whether this sweep may settle `record` terminally, as opposed to merely
 * handing it back.
 *
 * A stricter question than {@link belongsToBuild}, because it is asked before
 * the irreversible thing. Returning a run to `suspended` is recoverable and
 * self-correcting — a resume refuses a build whose graph does not match, with an
 * error naming the drift and a documented override. Settling one is neither: the
 * record becomes terminal, so nothing sweeps it again, and if the compensations
 * could not be resolved they are skipped for good, leaving a deploy standing
 * behind a record that says the run is over.
 *
 * So the graph has to agree too. Where it does not, this sweep leaves the run for
 * the one that recognises it.
 *
 * Where it does, this is as far as a heuristic reaches: two builds sharing a
 * class name, a root-target name and a graph shape are indistinguishable in a
 * record, and their target *bodies* may still do entirely different things. The
 * answer to that is not a cleverer comparison but a store per build — see
 * `docs/orchestration.md`. Note the blast radius differs by path: a stranded run
 * is finalised *without* compensations and into the terminal its own record
 * names, so a colliding build settles it exactly as the owning one would; a
 * past-deadline run does run compensations, which is why this check exists.
 */
function canSettle(record: RunRecord, deps: ReapDeps): boolean {
  if (!belongsToBuild(record, deps)) return false;
  const targets = discoverTargets(deps.build);
  const root = targets.get(record.rootTarget);
  if (root === undefined) return false;
  const planned = planGraph(root).order.map((t) => ({
    name: t.name_ ?? "",
    dependsOn: t.dependsOn_.map((d) => d.name_ ?? "").filter((n) => n !== ""),
  }));
  return graphAgrees(record.graph, planned);
}

/** Whether a recorded graph snapshot and a planned one describe the same shape. */
function graphAgrees(
  snapshot: readonly RunGraphNode[],
  planned: readonly RunGraphNode[],
): boolean {
  if (snapshot.length !== planned.length) return false;
  const recorded = new Map(snapshot.map((n) => [n.name, n.dependsOn]));
  return planned.every((node) => {
    const deps = recorded.get(node.name);
    if (deps === undefined || deps.length !== node.dependsOn.length) {
      return false;
    }
    const set = new Set(deps);
    return node.dependsOn.every((d) => set.has(d));
  });
}

/** Whether `record` has a deadline that `now` is past. */
function pastDeadline(record: RunRecord, now: string): boolean {
  if (record.deadlineAt === undefined) return false;
  const deadline = Date.parse(record.deadlineAt);
  // An unparseable deadline is not a passed one: refusing to guess is better
  // than settling a healthy run because a timestamp was malformed.
  return Number.isFinite(deadline) && Date.parse(now) > deadline;
}

/**
 * Move a run from `running` back to `suspended`, so the resume sweep can drive
 * it.
 *
 * Compare-and-swap, and the status is re-checked on every attempt: between
 * taking the lease and writing, the run may have been settled by a canceller or
 * picked up by something else, and moving it then would undo their work.
 */
async function toSuspended(id: string, deps: ReapDeps): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const loaded = await deps.store.getRun(id);
    if (loaded === null || loaded.record.status !== "running") return false;
    const at = deps.now();
    const next = structuredClone(loaded.record);
    next.status = "suspended";
    next.updatedAt = at;
    next.events.push(reapEvent(deps.actor, at));
    const result = await deps.store.putRun(next, loaded.version);
    if (result.ok) return true;
  }
  throw new Error(
    `reap: gave up returning ${id} to suspended after repeated conflicts.`,
  );
}

/** The audit event recording that a run was reaped. */
function reapEvent(actor: string, at: string): RunEvent {
  return {
    at,
    tool: "reap",
    actor,
    outcome: "ok",
    args: {},
    detail: "returned to suspended: its lease had lapsed",
  };
}
