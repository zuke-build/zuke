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

/** The lifecycle status of a whole run. */
export type RunStatus =
  | "running"
  | "suspended"
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
  return state;
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

  return {
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
  };
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
