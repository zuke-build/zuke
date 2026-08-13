// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The durable run-state vocabulary: {@link RunRecord} and its parts.
 *
 * A run record is a versioned JSON snapshot of one build run — its status, the
 * graph shape it ran, resolved (non-secret) parameters, and per-target
 * progress. It is written to a {@link "./store.ts".StateStore} at each state
 * transition so a run's full status can be reconstructed after the process
 * exits, and (from later milestones) so a suspended run can be resumed by a
 * different process.
 *
 * The record's target statuses are a **different vocabulary** from the
 * executor's in-memory {@link "../build.ts".TargetStatus} (`passed`/`cached`
 * both map to `succeeded`; `waiting` exists only here) — the two are kept
 * separate on purpose.
 *
 * @module
 */

import type { JsonValue } from "../target.ts";

/**
 * The lifecycle status of a whole run. `cancelling` is the transient state a
 * cancellation moves through — the run has been asked to stop and its
 * compensations are running — before it settles as `cancelled`.
 */
export type RunStatus =
  | "running"
  | "suspended"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * The status of one target within a run record. `waiting` (a suspended
 * external-event wait) is produced only from a later milestone; the executor
 * records the others.
 */
export type TargetRunStatus =
  | "pending"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "skipped";

/** A payload received for an external signal (see {@link RunRecord.signals}). */
export interface SignalRecord {
  /** The signal's JSON payload (`{}` when none was sent). */
  data: JsonValue;
  /** ISO-8601 timestamp when the signal was recorded. */
  receivedAt: string;
}

/** The outcome recorded for an audited MCP tool call (see {@link RunEvent}). */
export type RunEventOutcome = "ok" | "denied" | "error";

/**
 * One entry in a run's audit trail: an MCP tool call, who made it, and how it
 * ended. Appended (never mutated) so the trail is a chronological record. The
 * MCP server records a {@link RunEvent} for every mutating or denied tool call;
 * `zuke runs show` prints them.
 */
export interface RunEvent {
  /** ISO-8601 time the call was recorded. */
  at: string;
  /** The tool called (e.g. `run:deploy`, `signal_run`). */
  tool: string;
  /** Who made the call (a resolved actor; see {@link "./record.ts".resolveActor}). */
  actor: string;
  /** Whether the call ran, was denied by authorization, or errored. */
  outcome: RunEventOutcome;
  /** The call's arguments, **redacted** — secret values masked, tokens dropped. */
  args: Record<string, string>;
  /** A short, redacted human detail (e.g. a denial reason), when present. */
  detail?: string;
}

/** What a timed-out wait does: fail, cancel the run, or run a compensation target. */
export type WaitDisposition = "fail" | "cancel-run" | { target: string };

/** The pending wait recorded on a suspended target (see {@link TargetRunState.waitingFor}). */
export interface WaitState {
  /** A human-readable descriptor of what is awaited (e.g. `signal:approved`). */
  trigger: string;
  /** ISO-8601 deadline after which {@link onTimeout} applies, if a timeout was set. */
  deadline?: string;
  /** What happens when the deadline passes. */
  onTimeout: WaitDisposition;
}

/**
 * Where one declared effect has got to (see `.effect(...)`).
 *
 * `pending` is the load-bearing one: it means the intent was committed and the
 * body may or may not have run. A process that dies mid-effect leaves exactly
 * that, which is what tells a later resume to drive it again.
 */
export type EffectStatus = "pending" | "done" | "failed";

/**
 * The durable intent-and-completion row for one of a target's effects.
 *
 * There is no idempotency key here. An effect is identified by where it sits —
 * the run, the target, and its declared name — which the record already spells
 * out structurally, so a key would be a second spelling of the same fact and a
 * place for a secret to end up.
 */
export interface EffectState {
  /** How far the effect got. */
  status: EffectStatus;
  /** ISO-8601 time the intent was committed — always *before* the body ran. */
  intentAt: string;
  /** ISO-8601 time it settled, if it has. */
  settledAt?: string;
  /** The failure message when `status` is `failed`. */
  error?: string;
  /** How many times the body has been driven. Above one means it was re-driven. */
  attempts: number;
}

/** The recorded progress of a single target. */
export interface TargetRunState {
  /** The target's current status within the run. */
  status: TargetRunStatus;
  /** Durable metadata written via {@link "../target.ts".TargetStateHandle}. */
  meta: Record<string, JsonValue>;
  /** ISO-8601 timestamp when the body started, if it has. */
  startedAt?: string;
  /** ISO-8601 timestamp when the target settled, if it has. */
  endedAt?: string;
  /** The failure message when `status` is `failed`. */
  error?: string;
  /** The pending wait when `status` is `waiting` (set by `.waitsFor(...)`). */
  waitingFor?: WaitState;
  /**
   * The declared effects of this target, keyed by effect name — present only
   * once at least one has been armed.
   */
  effects?: Record<string, EffectState>;
}

/** One entry of a run's graph-shape snapshot. */
export interface RunGraphNode {
  /** The target's dotted name. */
  name: string;
  /** The dotted names of its direct dependencies. */
  dependsOn: string[];
}

/**
 * A versioned snapshot of one run. Persisted as JSON; a store's opaque
 * `version` (an ETag / content hash) drives compare-and-swap writes.
 */
export interface RunRecord {
  /** Unique run ID (matches {@link "../target.ts".TargetContext} `runId`). */
  id: string;
  /** The build class name. */
  build: string;
  /**
   * Which build **instance** this run belongs to — `ZUKE_BUILD_ID`, else
   * `GITHUB_REPOSITORY`, resolved once at creation. Absent when neither was set
   * (and on every record written before this field existed).
   *
   * The class name above cannot identify a build: a `zuke.ts` templated across
   * a dozen services shares its name, its target names and its graph shape, so
   * every shape-based check passes and one service's recovery sweep would drive
   * another's runs with its own target bodies. This is what a recovery path
   * compares; see {@link "../ownership.ts"}.
   */
  buildId?: string;
  /** The dotted name of the requested (root) target. */
  rootTarget: string;
  /** The run's lifecycle status. */
  status: RunStatus;
  /** Who started the run (resolved from `--actor`, `ZUKE_ACTOR`, or CI env). */
  actor: string;
  /** ISO-8601 timestamp when the run was created. */
  createdAt: string;
  /** ISO-8601 timestamp of the last write. */
  updatedAt: string;
  /** The graph shape the run planned, in declaration order. */
  graph: RunGraphNode[];
  /** Resolved parameter values, keyed by name. Secrets are always omitted. */
  params: Record<string, string>;
  /** Per-target progress, keyed by dotted target name. */
  targets: Record<string, TargetRunState>;
  /** External signals received so far, keyed by name (see `.waitsFor(...)`). */
  signals: Record<string, SignalRecord>;
  /** Append-only audit trail of MCP tool calls against this run (see {@link RunEvent}). */
  events: RunEvent[];
  /**
   * True when at least one state write for this run was **permanently lost** —
   * a conflicting write from another process could not be re-applied within the
   * writer's retry budget. Writes are best-effort, so the run itself carried on;
   * the flag is how a later reader learns that a transition which really
   * happened may be missing from the record. In particular a target that
   * succeeded can still be recorded `running` or `pending`, so a resume would
   * re-run it — which is why a resume refuses a degraded record unless
   * `--resume-degraded` overrides it (see
   * {@link "../resume.ts".ResumeOptions.resumeDegraded}) — and why a
   * cancellation compensates every target whose success the record cannot rule
   * out, rather than only those recorded `succeeded` (see
   * {@link "../cancel.ts".runCompensations}).
   *
   * It is set by the writer when it loses a write and persisted by the **next**
   * write that lands — the failing one, by definition, could not carry it. A
   * drop that leaves the mutation in memory for a later write to re-persist does
   * *not* set it. Absent (or `false`) means no write is known to be missing.
   */
  degraded?: boolean;
  /**
   * ISO-8601 wall-clock deadline for the whole run, stamped once at creation
   * from `Build.deadline()`. Absent when the build sets none.
   *
   * A budget for *running*, not for existing. A run parked at an approval gate
   * is not spending it — its budget there is the wait's own timeout — so only a
   * sweep over `running` runs consults this.
   */
  deadlineAt?: string;
  /**
   * The terminal status the process that moved this run to `cancelling` means
   * to leave it in. Absent means `cancelled`, which is what an ordinary
   * `zuke cancel` intends and what every record written before this field
   * existed meant.
   *
   * Recorded rather than inferred, because the settlement can be finished by a
   * *different* process than the one that began it: a canceller that crashes
   * leaves the run `cancelling`, and whoever recovers it has no other way to
   * know whether an operator was cancelling the run or a sweep was failing an
   * abandoned one.
   */
  intendedTerminal?: RunStatus;
}

/** A compact run listing row, returned by {@link "./store.ts".StateStore.listRuns}. */
export interface RunSummary {
  /** The run ID. */
  id: string;
  /** The build class name. */
  build: string;
  /** The dotted name of the requested (root) target. */
  rootTarget: string;
  /** The run's lifecycle status. */
  status: RunStatus;
  /** Who started the run. */
  actor: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp of the last write. */
  updatedAt: string;
}

/** Filters for {@link "./store.ts".StateStore.listRuns}; all fields are optional. */
export interface RunQuery {
  /** Keep only runs with this status. */
  status?: RunStatus;
  /** Keep only runs whose graph contains a target with this dotted name. */
  target?: string;
  /** Keep only runs created at or after this ISO-8601 timestamp. */
  since?: string;
  /**
   * Return at most this many runs (the newest, since listing is newest-first).
   * Applied server-side so a large store stays listable; `0` returns none.
   */
  limit?: number;
}

/** The projection of a {@link RunRecord} down to its {@link RunSummary}. */
export function toSummary(record: RunRecord): RunSummary {
  return {
    id: record.id,
    build: record.build,
    rootTarget: record.rootTarget,
    status: record.status,
    actor: record.actor,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** All valid {@link RunStatus} values, for validation. */
const RUN_STATUSES: readonly RunStatus[] = [
  "running",
  "suspended",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
];

/** The {@link RunStatus} values as a list, for CLI help and error messages. */
export const RUN_STATUS_NAMES: readonly string[] = RUN_STATUSES;

/** True when `value` is a valid {@link RunStatus} (used to validate CLI filters). */
export function isRunStatus(value: string): value is RunStatus {
  return RUN_STATUSES.some((s) => s === value);
}

/** All valid {@link TargetRunStatus} values, for validation. */
const TARGET_STATUSES: readonly TargetRunStatus[] = [
  "pending",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "skipped",
];

/** Serialise a run record to the canonical stored form (pretty JSON + newline). */
export function stringifyRunRecord(record: RunRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Narrow an unknown value to a plain object without casting, else `null`. */
function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) out[key] = val;
  return out;
}

/** Read a required string field, throwing a descriptive error if it is not one. */
function str(object: Record<string, unknown>, field: string): string {
  const value = object[field];
  if (typeof value !== "string") {
    throw new Error(`state: run record field "${field}" is not a string`);
  }
  return value;
}

/** Read an optional string field, throwing if present but not a string. */
function optionalStr(
  object: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = object[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`state: run record field "${field}" is not a string`);
  }
  return value;
}

/**
 * Read an optional boolean field, defaulting to `false` when absent — so a
 * record written before the field existed still parses — and throwing if it is
 * present but not a boolean.
 */
function optionalFlag(
  object: Record<string, unknown>,
  field: string,
): boolean {
  const value = object[field];
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new Error(`state: run record field "${field}" is not a boolean`);
  }
  return value;
}

/** Validate a target status string, narrowing it to {@link TargetRunStatus}. */
function targetStatus(value: string): TargetRunStatus {
  const match = TARGET_STATUSES.find((s) => s === value);
  if (match === undefined) {
    throw new Error(`state: unknown target status "${value}"`);
  }
  return match;
}

/** Validate and narrow one target's recorded state. */
function parseTargetState(value: unknown): TargetRunState {
  const object = asObject(value);
  if (object === null) throw new Error("state: target state is not an object");
  const meta = asObject(object.meta);
  const state: TargetRunState = {
    status: targetStatus(str(object, "status")),
    meta: meta === null ? {} : parseJsonRecord(meta),
  };
  // Only set optional fields that are present, so a round-trip preserves the
  // exact key set (JSON drops undefined, so re-parsing must not re-add them).
  const startedAt = optionalStr(object, "startedAt");
  if (startedAt !== undefined) state.startedAt = startedAt;
  const endedAt = optionalStr(object, "endedAt");
  if (endedAt !== undefined) state.endedAt = endedAt;
  const error = optionalStr(object, "error");
  if (error !== undefined) state.error = error;
  if (object.waitingFor !== undefined) {
    state.waitingFor = parseWaitState(object.waitingFor);
  }
  if (object.effects !== undefined) {
    state.effects = parseEffects(object.effects);
  }
  return state;
}

/** Validate a target's effect rows, keyed by effect name. */
function parseEffects(value: unknown): Record<string, EffectState> {
  const object = asObject(value);
  if (object === null) throw new Error("state: effects is not an object");
  const effects: Record<string, EffectState> = {};
  for (const [name, entry] of Object.entries(object)) {
    effects[name] = parseEffectState(entry);
  }
  return effects;
}

/** Validate and narrow one {@link EffectState}. */
function parseEffectState(value: unknown): EffectState {
  const object = asObject(value);
  if (object === null) throw new Error("state: effect state is not an object");
  const attempts = object.attempts;
  // At least one, and whole. An armed effect has been attempted once by
  // definition, and a record claiming zero would make a genuine re-drive report
  // itself as a first attempt — records can come from another writer, so the
  // shape is checked rather than trusted.
  if (
    typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 1
  ) {
    throw new Error("state: effect attempts is not a positive integer");
  }
  const state: EffectState = {
    status: effectStatus(str(object, "status")),
    intentAt: str(object, "intentAt"),
    attempts,
  };
  // Optional fields only when present, so a round-trip preserves the key set.
  const settledAt = optionalStr(object, "settledAt");
  if (settledAt !== undefined) state.settledAt = settledAt;
  const error = optionalStr(object, "error");
  if (error !== undefined) state.error = error;
  return state;
}

/** Validate an effect status. */
function effectStatus(value: string): EffectStatus {
  if (value === "pending" || value === "done" || value === "failed") {
    return value;
  }
  throw new Error(`state: unknown effect status "${value}"`);
}

/** Validate a timed-out-wait disposition. */
function parseWaitDisposition(value: unknown): WaitDisposition {
  if (value === "fail" || value === "cancel-run") return value;
  const object = asObject(value);
  if (object !== null && typeof object.target === "string") {
    return { target: object.target };
  }
  throw new Error("state: invalid wait onTimeout disposition");
}

/** Validate and narrow a {@link WaitState}. */
function parseWaitState(value: unknown): WaitState {
  const object = asObject(value);
  if (object === null) throw new Error("state: waitingFor is not an object");
  const state: WaitState = {
    trigger: str(object, "trigger"),
    onTimeout: parseWaitDisposition(object.onTimeout),
  };
  const deadline = optionalStr(object, "deadline");
  if (deadline !== undefined) state.deadline = deadline;
  return state;
}

/** All valid {@link RunEventOutcome} values, for validation. */
const RUN_EVENT_OUTCOMES: readonly RunEventOutcome[] = [
  "ok",
  "denied",
  "error",
];

/** Validate and narrow a {@link RunEvent} (an element of a run's audit trail). */
function parseRunEvent(value: unknown): RunEvent {
  const object = asObject(value);
  if (object === null) throw new Error("state: run event is not an object");
  const outcome = RUN_EVENT_OUTCOMES.find((o) => o === object.outcome);
  if (outcome === undefined) {
    throw new Error(`state: unknown run event outcome "${object.outcome}"`);
  }
  const rawArgs = asObject(object.args);
  const args: Record<string, string> = {};
  if (rawArgs !== null) {
    for (const [key, val] of Object.entries(rawArgs)) {
      if (typeof val === "string") args[key] = val;
    }
  }
  const event: RunEvent = {
    at: str(object, "at"),
    tool: str(object, "tool"),
    actor: str(object, "actor"),
    outcome,
    args,
  };
  const detail = optionalStr(object, "detail");
  if (detail !== undefined) event.detail = detail;
  return event;
}

/** Validate and narrow a {@link SignalRecord}. */
function parseSignalRecord(value: unknown): SignalRecord {
  const object = asObject(value);
  if (object === null) throw new Error("state: signal record is not an object");
  return {
    data: toJsonValue(object.data ?? null),
    receivedAt: str(object, "receivedAt"),
  };
}

/** Coerce an object's values to {@link JsonValue}s (they came from JSON already). */
function parseJsonRecord(
  object: Record<string, unknown>,
): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(object)) {
    out[key] = toJsonValue(value);
  }
  return out;
}

/** Coerce a value parsed from JSON to a {@link JsonValue} (rejects functions etc.). */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(toJsonValue);
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "object": {
      const object = asObject(value);
      return object === null ? null : parseJsonRecord(object);
    }
    default:
      throw new Error(`state: value of type "${typeof value}" is not JSON`);
  }
}

/**
 * Parse and validate a stored run record. Throws a descriptive error when the
 * text is not JSON or does not match the {@link RunRecord} shape — the HTTP
 * backend reads records from a service Zuke does not control, so the shape is
 * checked rather than trusted.
 */
export function parseRunRecord(text: string): RunRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("state: run record is not valid JSON");
  }
  const object = asObject(parsed);
  if (object === null) throw new Error("state: run record is not an object");

  const status = str(object, "status");
  const runStatus = RUN_STATUSES.find((s) => s === status);
  if (runStatus === undefined) {
    throw new Error(`state: unknown run status "${status}"`);
  }

  const rawGraph = object.graph;
  if (!Array.isArray(rawGraph)) {
    throw new Error(`state: run record field "graph" is not an array`);
  }
  const graph: RunGraphNode[] = rawGraph.map((node) => {
    const n = asObject(node);
    if (n === null) throw new Error("state: graph node is not an object");
    const dependsOn = n.dependsOn;
    if (
      !Array.isArray(dependsOn) || dependsOn.some((d) => typeof d !== "string")
    ) {
      throw new Error(`state: graph node "dependsOn" is not a string array`);
    }
    return { name: str(n, "name"), dependsOn: dependsOn.filter(isString) };
  });

  const rawParams = asObject(object.params);
  if (rawParams === null) {
    throw new Error(`state: run record field "params" is not an object`);
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value !== "string") {
      throw new Error(`state: param "${key}" is not a string`);
    }
    params[key] = value;
  }

  const rawTargets = asObject(object.targets);
  if (rawTargets === null) {
    throw new Error(`state: run record field "targets" is not an object`);
  }
  const targets: Record<string, TargetRunState> = {};
  for (const [name, value] of Object.entries(rawTargets)) {
    targets[name] = parseTargetState(value);
  }

  // `signals` is newer than the first records — treat its absence as empty so
  // records written before external-event waits existed still parse.
  const signals: Record<string, SignalRecord> = {};
  if (object.signals !== undefined) {
    const rawSignals = asObject(object.signals);
    if (rawSignals === null) {
      throw new Error(`state: run record field "signals" is not an object`);
    }
    for (const [name, value] of Object.entries(rawSignals)) {
      signals[name] = parseSignalRecord(value);
    }
  }

  // `events` (the MCP audit trail) is newer still — absent records parse with an
  // empty trail, exactly as `signals` above.
  const events: RunEvent[] = [];
  if (object.events !== undefined) {
    if (!Array.isArray(object.events)) {
      throw new Error(`state: run record field "events" is not an array`);
    }
    for (const value of object.events) events.push(parseRunEvent(value));
  }

  const record: RunRecord = {
    id: str(object, "id"),
    build: str(object, "build"),
    rootTarget: str(object, "rootTarget"),
    status: runStatus,
    actor: str(object, "actor"),
    createdAt: str(object, "createdAt"),
    updatedAt: str(object, "updatedAt"),
    graph,
    params,
    targets,
    signals,
    events,
    // Newer than the records above — absent means no dropped write is known of,
    // so an older record reads back as trustworthy.
    degraded: optionalFlag(object, "degraded"),
  };
  // Optional and only when present, so a round-trip preserves the exact key set
  // and a record written before these existed parses unchanged.
  const buildId = optionalStr(object, "buildId");
  if (buildId !== undefined) record.buildId = buildId;
  const deadlineAt = optionalStr(object, "deadlineAt");
  if (deadlineAt !== undefined) record.deadlineAt = deadlineAt;
  const intended = optionalStr(object, "intendedTerminal");
  if (intended !== undefined) {
    const found = RUN_STATUSES.find((s) => s === intended);
    if (found === undefined) {
      throw new Error(`state: unknown intended terminal status "${intended}"`);
    }
    record.intendedTerminal = found;
  }
  return record;
}

/** A `filter` type guard that narrows to `string`. */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Parse and validate a {@link RunSummary} from an untrusted value (an element
 * of the HTTP list response). Throws when a field is missing or the wrong type.
 */
export function parseRunSummary(value: unknown): RunSummary {
  const object = asObject(value);
  if (object === null) throw new Error("state: run summary is not an object");
  const status = str(object, "status");
  const runStatus = RUN_STATUSES.find((s) => s === status);
  if (runStatus === undefined) {
    throw new Error(`state: unknown run status "${status}"`);
  }
  return {
    id: str(object, "id"),
    build: str(object, "build"),
    rootTarget: str(object, "rootTarget"),
    status: runStatus,
    actor: str(object, "actor"),
    createdAt: str(object, "createdAt"),
    updatedAt: str(object, "updatedAt"),
  };
}
