// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link RunStateWriter} — the executor's live view of a run's {@link RunRecord},
 * persisting each transition to a {@link StateStore}.
 *
 * Writes are serialised through an internal promise chain, so concurrent
 * targets never race each other's compare-and-swap; a conflict from *another*
 * process is handled by re-reading and re-applying. Every write is best-effort:
 * a store hiccup is reported through `warn` but never crashes the build — the
 * build's real work outweighs its bookkeeping. A dropped write whose mutation is
 * **permanently lost** marks the record {@link RunRecord.degraded}, so a later
 * resume can refuse to trust progress the record never captured; a drop that
 * leaves the mutation in memory for a later write to carry only warns. Every
 * value written through
 * {@link "../target.ts".TargetStateHandle} is passed through the run's
 * {@link Redactor} first, so a secret that slips into `ctx.state` is masked
 * before it is persisted.
 *
 * @module
 */

import type { TargetStatus } from "../build.ts";
import type { JsonValue, TargetStateHandle } from "../target.ts";
import type { Redactor } from "../redact.ts";
import type { StateStore } from "./store.ts";
import type {
  RunEvent,
  RunRecord,
  RunStatus,
  SignalRecord,
  TargetRunState,
  WaitState,
} from "./types.ts";
import { recordStatusOf } from "./record.ts";
import { acquireCancelLock, type CancelLock } from "./cancel_lock.ts";
import { messageOf } from "../internal.ts";

/** How many times a conflicting write is re-read and retried before giving up. */
const MAX_RETRIES = 5;

/**
 * An effect write was refused because the run is no longer `running` — another
 * process settled it while this one was still working.
 *
 * Its own type because the caller has to tell it apart from a store being
 * unreachable: this one means "stop, someone else owns the outcome now", and
 * retrying it would be the bug.
 */
export class RunNotActiveError extends Error {
  /** The error name. */
  override name = "RunNotActiveError";
  /** The run that is no longer running. */
  readonly runId: string;
  /** The status it is in now. */
  readonly status: RunStatus;
  /** Build the error from the run and the status that refused the write. */
  constructor(runId: string, status: RunStatus) {
    super(
      `run "${runId}" is ${status}, not running — refusing to record an ` +
        `effect on it. Another process has settled this run, and its outcome ` +
        `is that process's to report.`,
    );
    this.runId = runId;
    this.status = status;
  }
}

/**
 * Whether `status` means some other process has taken this run's outcome.
 *
 * Everything except the two states a run is in while *this* process is working
 * on it. A settlement from outside — an operator cancelling, a sweep failing an
 * abandoned or expired run — must never be reverted by the process it settled,
 * and `succeeded` is in the set for the same reason from the other direction: if
 * the record already says the run ended, this process is not the one deciding
 * how.
 */
function isSettledElsewhere(status: RunStatus): boolean {
  return status !== "running" && status !== "suspended";
}

/** Ensure a target's entry exists in the record, seeding it `pending`. */
function ensureTarget(record: RunRecord, name: string): TargetRunState {
  const existing = record.targets[name];
  if (existing !== undefined) return existing;
  const seeded: TargetRunState = { status: "pending", meta: {} };
  record.targets[name] = seeded;
  return seeded;
}

/** Recursively mask any secret string within a JSON value. */
function redactJson(value: JsonValue, redactor: Redactor): JsonValue {
  if (typeof value === "string") return redactor.redact(value);
  if (Array.isArray(value)) return value.map((v) => redactJson(v, redactor));
  if (value !== null && typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = redactJson(v, redactor);
    }
    return out;
  }
  return value;
}

/** Keeps a run's {@link RunRecord} in sync with a {@link StateStore}. */
export class RunStateWriter {
  readonly #store: StateStore;
  readonly #now: () => string;
  readonly #redactor: Redactor;
  readonly #warn?: (message: string) => void;
  /** Fired when a CAS re-read finds the run cancelling/cancelled by another process. */
  readonly #onExternalCancel?: () => void;
  #record: RunRecord;
  #version: string | null;
  /**
   * Latched once a conflicting re-read shows another process settled this run.
   *
   * A latch rather than a check, because the guard that notices only runs on a
   * *conflict*: once this writer has re-synced to the settled record, its later
   * writes land unchallenged and would happily set a status of their own. The
   * flag is what stops a run this process merely finished from reporting
   * `succeeded` over the terminal a sweep already wrote.
   */
  #settledElsewhere = false;
  /**
   * Latched by {@link disown} once this process stops owning the run. Checked
   * when a queued mutation actually runs, not when it is queued, so writes
   * already sitting on the chain are neutralised too.
   */
  #disowned = false;
  #chain: Promise<void> = Promise.resolve();

  private constructor(
    store: StateStore,
    record: RunRecord,
    version: string | null,
    now: () => string,
    redactor: Redactor,
    warn?: (message: string) => void,
    onExternalCancel?: () => void,
  ) {
    this.#store = store;
    this.#record = record;
    this.#now = now;
    this.#redactor = redactor;
    this.#warn = warn;
    this.#onExternalCancel = onExternalCancel;
    this.#version = version;
  }

  /**
   * Create a writer and persist the initial record (status `running`, targets
   * `pending`). The create rides the same best-effort path as every other
   * write, so a store that is briefly unavailable is reported, not fatal.
   * `onExternalCancel` is invoked if a later write discovers the run has been
   * moved to `cancelling`/`cancelled` by another process (see {@link "#applyAndPersist"}).
   */
  static async open(
    store: StateStore,
    record: RunRecord,
    now: () => string,
    redactor: Redactor,
    warn?: (message: string) => void,
    onExternalCancel?: () => void,
  ): Promise<RunStateWriter> {
    // version null → the first write is a create.
    const writer = new RunStateWriter(
      store,
      record,
      null,
      now,
      redactor,
      warn,
      onExternalCancel,
    );
    await writer.#update(() => {});
    return writer;
  }

  /**
   * Wrap an **existing** record at its current `version` without writing — for
   * resuming a run whose transition to `running` already landed. Subsequent
   * transitions continue from that version.
   */
  static adopt(
    store: StateStore,
    record: RunRecord,
    version: string,
    now: () => string,
    redactor: Redactor,
    warn?: (message: string) => void,
    onExternalCancel?: () => void,
  ): RunStateWriter {
    return new RunStateWriter(
      store,
      record,
      version,
      now,
      redactor,
      warn,
      onExternalCancel,
    );
  }

  /** The current run id. */
  get runId(): string {
    return this.#record.id;
  }

  /** The live in-memory record — its per-target `meta` drives an in-process cancel walk. */
  snapshot(): RunRecord {
    return this.#record;
  }

  /** Await every write queued so far, so nothing is still persisting on return. */
  drain(): Promise<void> {
    return this.#chain;
  }

  /** Mark a target `running` and stamp its start time. */
  markTargetRunning(name: string): Promise<void> {
    const at = this.#now();
    return this.#update((record) => {
      const target = ensureTarget(record, name);
      target.status = "running";
      target.startedAt = at;
    });
  }

  /** Record a target's terminal status (mapped from the executor's vocabulary). */
  markTargetSettled(
    name: string,
    status: TargetStatus,
    error?: string,
  ): Promise<void> {
    const at = this.#now();
    const recorded = recordStatusOf(status);
    const message = error === undefined
      ? undefined
      : this.#redactor.redact(error);
    return this.#update((record) => {
      const target = ensureTarget(record, name);
      target.status = recorded;
      target.endedAt = at;
      if (message !== undefined) target.error = message;
      // A settled target is no longer waiting (e.g. a gate satisfied on resume).
      delete target.waitingFor;
    });
  }

  /**
   * Whether another process has taken this run's outcome, so this one's view of
   * how the run ended is no longer authoritative.
   */
  settledElsewhere(): boolean {
    return this.#settledElsewhere;
  }

  /**
   * Stop writing: this process no longer owns the run, so nothing it has left
   * to say about it may reach the store.
   *
   * Called when the run's lease is lost. Every write from that instant is a
   * no-op — including ones already queued, because the check runs when a
   * mutation is applied rather than when it is enqueued. Without it, the walk
   * that stops the run queues a `skipped` row for every target it never reached,
   * and those rows land on the record through the writer's compare-and-swap,
   * overwriting the progress the new holder is making right now.
   *
   * One-way: a run is never re-owned by the process that lost it.
   */
  disown(): void {
    this.#disowned = true;
  }

  /** Record the run's terminal status, unless another process already has. */
  markRunFinished(ok: boolean): Promise<void> {
    return this.#update((record) => {
      // Whoever settled this run owns how it ended. The per-target progress
      // recorded alongside is still worth keeping, so this is a no-op rather
      // than a refusal.
      if (this.#settledElsewhere) return;
      record.status = ok ? "succeeded" : "failed";
    });
  }

  /** Record a target as waiting on an external event, with its pending wait. */
  markTargetWaiting(name: string, wait: WaitState): Promise<void> {
    return this.#update((record) => {
      const target = ensureTarget(record, name);
      target.status = "waiting";
      // Redact the trigger descriptor like every other stored string (errors,
      // audit args, meta): a secret routed into a signal name — e.g.
      // `externalSignal(this.token.value)` → `signal:<secret>` — must not be
      // persisted or exported (via @zuke/otel) or printed in the clear.
      target.waitingFor = {
        ...wait,
        trigger: this.#redactor.redact(wait.trigger),
      };
    });
  }

  /** Record the run as suspended, unless another process already settled it. */
  markRunSuspended(): Promise<void> {
    return this.#update((record) => {
      if (this.#settledElsewhere) return;
      record.status = "suspended";
    });
  }

  /** Record the run as `cancelling` — asked to stop; compensations are running. */
  markRunCancelling(): Promise<void> {
    return this.#update((record) => {
      record.status = "cancelling";
    });
  }

  /** Record the run as `cancelled` — the terminal state after compensations. */
  markRunCancelled(): Promise<void> {
    return this.#update((record) => {
      record.status = "cancelled";
    });
  }

  /**
   * Try to hold this run's per-run cancellation lock (see
   * {@link "./cancel_lock.ts".acquireCancelLock}) so the executor's in-process
   * compensation walk and an out-of-process `zuke cancel` cannot both drive it.
   * Returns the held lock, or `null` if another live canceller holds it.
   */
  acquireCancelLock(actor: string): Promise<CancelLock | null> {
    return acquireCancelLock(this.#store, this.#record.id, actor, this.#now);
  }

  /**
   * Append an {@link RunEvent} to the run's audit trail (the MCP tool-call log).
   * Its `args` values and `detail` are run through the redactor first, so a
   * secret that reached a tool argument is masked before it is persisted.
   */
  appendEvent(event: RunEvent): Promise<void> {
    const redacted = this.#redactEvent(event);
    // Appends survive being disowned. What {@link disown} exists to prevent is
    // this process *overwriting* the new holder's view — a stale target row
    // replacing real progress. An event is purely additive: it says "this
    // happened", and it stays true whoever owns the run now. Losing them is the
    // worse outcome, because the thing most worth recording at that moment is
    // the rollback this process had already performed before it stopped.
    return this.#update((record) => {
      record.events.push(redacted);
    }, { evenIfDisowned: true });
  }

  /** Copy a {@link RunEvent} with its `args` values and `detail` redacted. */
  #redactEvent(event: RunEvent): RunEvent {
    const args: Record<string, string> = {};
    for (const [key, value] of Object.entries(event.args)) {
      args[key] = this.#redactor.redact(value);
    }
    const out: RunEvent = {
      at: event.at,
      tool: event.tool,
      actor: event.actor,
      outcome: event.outcome,
      args,
    };
    if (event.detail !== undefined) {
      out.detail = this.#redactor.redact(event.detail);
    }
    return out;
  }

  /** The external signals received so far, as a read-only map. */
  signals(): ReadonlyMap<string, SignalRecord> {
    return new Map(Object.entries(this.#record.signals));
  }

  /** A {@link TargetStateHandle} bound to `name`, persisting through this writer. */
  stateHandle(name: string): TargetStateHandle {
    return {
      get: () => ({ ...(this.#record.targets[name]?.meta ?? {}) }),
      set: (patch) => {
        const redacted: Record<string, JsonValue> = {};
        for (const [key, value] of Object.entries(patch)) {
          redacted[key] = redactJson(value, this.#redactor);
        }
        return this.#update((record) => {
          const target = ensureTarget(record, name);
          target.meta = { ...target.meta, ...redacted };
        });
      },
    };
  }

  /**
   * Commit the intent to run `effect` on `target`, before its body does
   * anything.
   *
   * Returns `"skip"` when the effect is already recorded `done` — the no-op that
   * makes a re-drive after a completed effect harmless — and `"run"` once the
   * intent is armed `pending`. A previous `failed` attempt is re-armed and
   * `attempts` goes up.
   *
   * Unlike every other method here this is **strict**: it resolves only once the
   * write has landed, and throws otherwise. A caller that cannot record its
   * intent must not perform the effect, because nothing would then know to
   * re-drive it — the whole point is that the record leads the side effect
   * rather than trailing it.
   *
   * @throws {RunNotActiveError} if the run is no longer `running` — see
   * {@link "#applyStrict"} for why that check is what stops a stale process
   * writing over a settled run.
   */
  beginEffect(target: string, effect: string): Promise<"run" | "skip"> {
    const at = this.#now();
    let gate: "run" | "skip" = "run";
    return this.#updateStrict((record) => {
      const state = ensureTarget(record, target);
      const effects = state.effects ?? {};
      state.effects = effects;
      const existing = effects[effect];
      if (existing?.status === "done") {
        gate = "skip";
        return;
      }
      gate = "run";
      effects[effect] = {
        status: "pending",
        intentAt: existing?.intentAt ?? at,
        attempts: (existing?.attempts ?? 0) + 1,
      };
    }).then(() => gate);
  }

  /**
   * Record that `effect` on `target` finished, or failed.
   *
   * Strict for the same reason as {@link beginEffect}, from the other side: a
   * lost `done` leaves the effect `pending`, and a later resume drives it again.
   * That is survivable — the contract is at-least-once — but it should be
   * reported rather than silently absorbed.
   */
  markEffectSettled(
    target: string,
    effect: string,
    ok: boolean,
    error?: string,
  ): Promise<void> {
    const at = this.#now();
    const message = error === undefined
      ? undefined
      : this.#redactor.redact(error);
    return this.#updateStrict((record) => {
      const state = ensureTarget(record, target);
      const effects = state.effects ?? {};
      state.effects = effects;
      const existing = effects[effect];
      // Never write over a completed effect. Once two processes can share a
      // running run, a re-applied `failed` from the slower one would bury a
      // `done` the faster one already recorded — leaving the record claiming an
      // effect failed when it had in fact succeeded.
      if (existing?.status === "done") return;
      effects[effect] = {
        status: ok ? "done" : "failed",
        intentAt: existing?.intentAt ?? at,
        attempts: existing?.attempts ?? 1,
        settledAt: at,
        ...(message === undefined ? {} : { error: message }),
      };
    });
  }

  /** Serialise `mutator` after all pending writes, then persist (best-effort). */
  #update(
    mutator: (record: RunRecord) => void,
    options: { evenIfDisowned?: boolean } = {},
  ): Promise<void> {
    this.#chain = this.#chain.then(() =>
      this.#applyAndPersist(mutator, options.evenIfDisowned === true)
    );
    return this.#chain;
  }

  /**
   * Serialise `mutator` like {@link "#update"}, but hand its failure to the
   * caller.
   *
   * The chain deliberately does not inherit the rejection. `#chain` is shared by
   * every write on this writer, so assigning it a rejected promise would make
   * each later best-effort write reject too — one failed effect intent would
   * take the run's whole bookkeeping down with it. The caller gets the real
   * promise; the chain gets a settled copy that only preserves ordering.
   */
  #updateStrict(mutator: (record: RunRecord) => void): Promise<void> {
    const result = this.#chain.then(() => this.#applyStrict(mutator));
    this.#chain = result.then(() => {}, () => {});
    return result;
  }

  /**
   * Apply `mutator` and CAS-write, refusing to write to a run that is not
   * `running` and throwing rather than dropping the write.
   *
   * The status check is the important half, and it is checked again after every
   * re-read. A process can be alive and holding a stale view of a run another
   * process has already settled — a sweeper that reaped it past its deadline,
   * say. The best-effort path handles that by re-applying its mutation onto the
   * settling record and carrying on, which is right for bookkeeping and wrong
   * for an effect: it would arm the intent and let the body post a result over
   * the one the settler already published. For a merge gate that is a green
   * check on top of a red one, so an effect write to a non-`running` run is
   * refused outright.
   *
   * The executor is still told, via `onExternalCancel`, so it stops rather than
   * carrying on to the next target.
   */
  async #applyStrict(mutator: (record: RunRecord) => void): Promise<void> {
    if (this.#disowned) {
      throw new RunNotActiveError(this.#record.id, this.#record.status);
    }
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (this.#record.status !== "running") {
        throw new RunNotActiveError(this.#record.id, this.#record.status);
      }
      // The mutation is applied to the live record, so a throw would otherwise
      // leave it there for the next write that lands to persist — recording an
      // intent for an effect that provably never ran, and making the body's
      // first execution report itself as a re-drive. Keep a copy so a refusal
      // really does leave nothing behind.
      //
      // The whole record, not just `targets`: today both strict mutators touch
      // only target rows, but a snapshot scoped to what the *current* callers
      // happen to write is a guard that silently stops guarding the moment
      // somebody adds a third. `updatedAt` is part of it — a refused write must
      // not leave the record claiming a modification time no write ever landed.
      //
      // Restored *into* the live record rather than by swapping the reference,
      // because `snapshot()` hands that object out and a compensation walk holds
      // it across awaits; replacing it would leave that walk reading a record
      // nothing writes to any more. (The one thing this cannot undo is a
      // top-level key a mutator adds where none existed — no current mutator
      // does, and both write only through `ensureTarget`.)
      const before = structuredClone(this.#record);
      mutator(this.#record);
      this.#record.updatedAt = this.#now();
      let result;
      try {
        result = await this.#store.putRun(this.#record, this.#version);
      } catch (error) {
        Object.assign(this.#record, before);
        throw error;
      }
      if (result.ok) {
        this.#version = result.version;
        return;
      }
      // Another writer moved the record on. Re-read a fresh base and re-apply on
      // the next pass — the mutation just applied is discarded with the stale
      // base, exactly as in the best-effort path.
      const fresh = await this.#store.getRun(this.#record.id).catch(
        (error: unknown) => {
          Object.assign(this.#record, before);
          throw error;
        },
      );
      if (fresh === null) {
        Object.assign(this.#record, before);
        throw new Error(
          `state: run "${this.#record.id}" vanished from the store while ` +
            `recording an effect; refusing to run it without a durable intent`,
        );
      }
      const degraded = this.#record.degraded;
      this.#record = fresh.record;
      this.#record.degraded ||= degraded;
      this.#version = fresh.version;
      if (fresh.record.status !== "running") {
        this.#onExternalCancel?.();
        throw new RunNotActiveError(fresh.record.id, fresh.record.status);
      }
    }
    // The last attempt's mutation went with the stale base it was applied to,
    // and no later write carries it — the same permanent loss the best-effort
    // path marks, so mark it the same way. It matters here because a resume
    // that cannot trust the record is exactly what `--resume-degraded` makes
    // an operator opt into before a non-idempotent step is repeated.
    this.#lostWrite(
      `state: gave up recording an effect on run "${this.#record.id}" after ` +
        `${MAX_RETRIES} conflicting writes`,
    );
    throw new Error(
      `state: gave up recording an effect on run "${this.#record.id}" after ` +
        `${MAX_RETRIES} conflicting writes`,
    );
  }

  /**
   * Report a dropped write whose mutation is **permanently lost**, and mark the
   * record `degraded` so a later reader — a resume above all — knows its
   * per-target progress may be missing a transition that really happened.
   *
   * Only two sites are lossy. Giving up after `MAX_RETRIES` conflicts is one:
   * the final attempt applied the mutation to a base that was then replaced by
   * the freshly-read record, so nothing carries it forward. A failed re-apply
   * onto a cancelling record is the other: the canceller owns finalisation from
   * there, so no later write of ours will land to re-persist it.
   *
   * The flag rides along with the next write that *does* land — the failing
   * write, by definition, could not carry it. Losing a write stays non-fatal;
   * this only records that it happened.
   */
  #lostWrite(message: string): void {
    this.#record.degraded = true;
    this.#warn?.(message);
  }

  /**
   * Report a dropped write whose mutation is **retained**: both the vanished-run
   * path and the store-error path leave the mutation applied to `this.#record`,
   * so any later write that lands re-persists it. Nothing was lost, so the
   * record is deliberately *not* marked `degraded` — that flag means "a mutation
   * was permanently lost", and setting it here would make a resume refuse a
   * record with nothing missing.
   */
  #retainedWrite(message: string): void {
    this.#warn?.(message);
  }

  /** Apply `mutator` and CAS-write, re-reading and retrying on conflict. */
  async #applyAndPersist(
    mutator: (record: RunRecord) => void,
    evenIfDisowned = false,
  ): Promise<void> {
    if (this.#disowned && !evenIfDisowned) return;
    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        mutator(this.#record);
        this.#record.updatedAt = this.#now();
        const result = await this.#store.putRun(this.#record, this.#version);
        if (result.ok) {
          this.#version = result.version;
          return;
        }
        // Another writer moved the record on: re-read a FRESH base and re-apply
        // the mutator to it on the next iteration. If the run has vanished
        // (deleted/pruned mid-write) there is no clean base to CAS onto — and
        // the in-memory record already carries this mutation, so re-running the
        // mutator on it would double-apply (e.g. push an audit event twice).
        // Drop this best-effort write instead (F12).
        const fresh = await this.#store.getRun(this.#record.id);
        if (fresh === null) {
          this.#retainedWrite(
            `state: run "${this.#record.id}" vanished from the store ` +
              `mid-write; dropping one update`,
          );
          return;
        }
        // Adopt the fresh base, but carry a degraded flag across: whoever wrote
        // the record in the store never saw the write we already lost.
        const degraded = this.#record.degraded;
        this.#record = fresh.record;
        this.#record.degraded ||= degraded;
        this.#version = fresh.version;
        // Another process has taken the run's outcome: a `zuke cancel`, or a
        // sweep settling a run it found abandoned or past its deadline. Re-apply
        // our (target-level) change onto its record — so a just-settled
        // `succeeded` target isn't lost to the settler's compensation walk — but
        // never revert the status it wrote. Then signal the run to abort: what
        // happens next is the settler's to decide.
        //
        // Every status but our own two matters here, not just the cancel pair.
        // A sweep leaves a run `failed`, and a run this process then finishes
        // would otherwise re-apply `succeeded` over it and report success — a
        // green result for work another process had already unwound.
        if (isSettledElsewhere(fresh.record.status)) {
          const settledStatus = fresh.record.status;
          this.#settledElsewhere = true;
          mutator(this.#record);
          this.#record.status = settledStatus;
          this.#record.updatedAt = this.#now();
          const reapply = await this.#store.putRun(
            this.#record,
            this.#version,
          );
          if (reapply.ok) {
            this.#version = reapply.version;
          } else {
            // The canceller finalises the run from here, so no later write of
            // ours lands to carry this mutation: it is gone for good.
            this.#lostWrite(
              `state: run "${this.#record.id}" was settled elsewhere and ` +
                `re-applying one update onto its record conflicted; ` +
                `losing that update`,
            );
          }
          this.#onExternalCancel?.();
          return;
        }
      }
      this.#lostWrite(
        `state: gave up persisting run "${this.#record.id}" after ` +
          `${MAX_RETRIES} conflicting writes`,
      );
    } catch (error) {
      this.#retainedWrite(
        `state: failed to persist run "${this.#record.id}": ${
          messageOf(error)
        }`,
      );
    }
  }
}

/**
 * A no-op {@link TargetStateHandle} for runs with no store: `set` retains the
 * patch in memory for the current process so `get` is consistent within the
 * run, but nothing is persisted.
 */
export function inMemoryStateHandle(): TargetStateHandle {
  const meta: Record<string, JsonValue> = {};
  return {
    get: () => ({ ...meta }),
    set: (patch) => {
      Object.assign(meta, patch);
      return Promise.resolve();
    },
  };
}
