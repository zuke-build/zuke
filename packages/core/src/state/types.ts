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
  return state;
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
function toJsonValue(value: unknown): JsonValue {
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
