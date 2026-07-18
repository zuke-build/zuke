/**
 * {@link RunStateWriter} — the executor's live view of a run's {@link RunRecord},
 * persisting each transition to a {@link StateStore}.
 *
 * Writes are serialised through an internal promise chain, so concurrent
 * targets never race each other's compare-and-swap; a conflict from *another*
 * process is handled by re-reading and re-applying. Every write is best-effort:
 * a store hiccup is reported through `warn` but never crashes the build — the
 * build's real work outweighs its bookkeeping. Every value written through
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
  SignalRecord,
  TargetRunState,
  WaitState,
} from "./types.ts";
import { recordStatusOf } from "./record.ts";

/** Extract a message from an unknown thrown value without casting. */
function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** How many times a conflicting write is re-read and retried before giving up. */
const MAX_RETRIES = 5;

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

  /** Record the run's terminal status. */
  markRunFinished(ok: boolean): Promise<void> {
    return this.#update((record) => {
      record.status = ok ? "succeeded" : "failed";
    });
  }

  /** Record a target as waiting on an external event, with its pending wait. */
  markTargetWaiting(name: string, wait: WaitState): Promise<void> {
    return this.#update((record) => {
      const target = ensureTarget(record, name);
      target.status = "waiting";
      target.waitingFor = wait;
    });
  }

  /** Record the run as suspended (parked at a `.waitsFor(...)` gate). */
  markRunSuspended(): Promise<void> {
    return this.#update((record) => {
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
   * Append an {@link RunEvent} to the run's audit trail (the MCP tool-call log).
   * Its `args` values and `detail` are run through the redactor first, so a
   * secret that reached a tool argument is masked before it is persisted.
   */
  appendEvent(event: RunEvent): Promise<void> {
    const redacted = this.#redactEvent(event);
    return this.#update((record) => {
      record.events.push(redacted);
    });
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

  /** Serialise `mutator` after all pending writes, then persist (best-effort). */
  #update(mutator: (record: RunRecord) => void): Promise<void> {
    this.#chain = this.#chain.then(() => this.#applyAndPersist(mutator));
    return this.#chain;
  }

  /** Apply `mutator` and CAS-write, re-reading and retrying on conflict. */
  async #applyAndPersist(mutator: (record: RunRecord) => void): Promise<void> {
    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        mutator(this.#record);
        this.#record.updatedAt = this.#now();
        const result = await this.#store.putRun(this.#record, this.#version);
        if (result.ok) {
          this.#version = result.version;
          return;
        }
        // Another writer moved the record on: re-read and re-apply the mutator.
        const fresh = await this.#store.getRun(this.#record.id);
        this.#record = fresh?.record ?? this.#record;
        this.#version = fresh?.version ?? null;
        // The other writer may be a `zuke cancel` in another process. If it has
        // moved the run to cancelling/cancelled, re-apply our (target-level)
        // change onto its record — so a just-settled `succeeded` target isn't
        // lost to the canceller's compensation walk — but never revert the run's
        // cancel status. Then signal the run to abort: its compensations are the
        // canceller's responsibility now. Best-effort (a conflict here is
        // harmless; the canceller owns finalisation).
        if (
          fresh !== null &&
          (fresh.record.status === "cancelling" ||
            fresh.record.status === "cancelled")
        ) {
          const cancelStatus = fresh.record.status;
          mutator(this.#record);
          this.#record.status = cancelStatus;
          this.#record.updatedAt = this.#now();
          const reapply = await this.#store.putRun(
            this.#record,
            this.#version,
          );
          if (reapply.ok) this.#version = reapply.version;
          this.#onExternalCancel?.();
          return;
        }
      }
      this.#warn?.(
        `state: gave up persisting run "${this.#record.id}" after ` +
          `${MAX_RETRIES} conflicting writes`,
      );
    } catch (error) {
      this.#warn?.(
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
