/**
 * The store-backed MCP tools: `list_runs`/`show_run` (read-only, exposed
 * whenever a state store resolves) and `signal_run`/`resume_check` (mutating,
 * gated like the `run:` tools). They are thin wrappers over the same durable
 * surfaces the CLI uses — `StateStore.listRuns`/`getRun` and
 * `resumeRun`/`resumeCheck` — so a remote agent can query and advance runs it
 * did not start. Typed failures (a lost resume race, a lock conflict) come back
 * as structured JSON tool results rather than flattened strings.
 *
 * @module
 */

import type { Build } from "../build.ts";
import { cancelRun } from "../cancel.ts";
import { AlreadyResumedError, resumeCheck, resumeRun } from "../resume.ts";
import { LockConflictError } from "../state/lock.ts";
import type { StateStore } from "../state/store.ts";
import {
  isRunStatus,
  RUN_STATUS_NAMES,
  type RunQuery,
  toJsonValue,
} from "../state/types.ts";
import type { JsonValue } from "../target.ts";
import type { McpTool } from "./server.ts";

/** What a run-state tool needs to reach the durable surfaces. */
export interface RunToolDeps {
  /** The resolved state store the tools read and write. */
  store: StateStore;
  /** The build, re-instantiated per run, for `signal_run`/`resume_check`. */
  build: Build;
  /** The actor to attribute a resume to (already resolved). */
  actor?: string;
  /** Reads an environment variable (secrets re-resolve from here on a resume). */
  readEnv: (name: string) => string | undefined;
  /**
   * Authorize resuming a run whose root target is `targetName`, applying the
   * same allow-list and operator-token gates as a `run:` tool (a resume runs
   * that target's code). Returns a denial reason, or `null` when allowed.
   */
  authorize: (
    targetName: string,
    args: Record<string, unknown>,
  ) => string | null;
}

/** A run-state tool's rendered result: JSON text plus the MCP error flag. */
export interface RunToolResult {
  /** The JSON (or message) text block returned to the client. */
  text: string;
  /** Whether the call is reported to the model as an error. */
  isError: boolean;
}

/** The read-only run-state tools, always exposed when a store resolves. */
const READ_TOOLS: readonly McpTool[] = [
  {
    name: "list_runs",
    description:
      "List persisted runs (newest first). Optional filters: status, target, since (ISO-8601), limit.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: `Filter by run status (${RUN_STATUS_NAMES.join(", ")}).`,
        },
        target: {
          type: "string",
          description: "Keep only runs whose graph contains this target.",
        },
        since: {
          type: "string",
          description: "Keep only runs created at/after this ISO-8601 time.",
        },
        limit: {
          type: "integer",
          description: "Return at most this many runs (the newest).",
        },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "show_run",
    description:
      "Show one run's full record: status, parameters, per-target progress, signals, and audit trail.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The run id to show." },
      },
      required: ["runId"],
    },
    annotations: { readOnlyHint: true },
  },
];

/** The mutating run-state tools, exposed only when execution is enabled. */
const MUTATING_TOOLS: readonly McpTool[] = [
  {
    name: "signal_run",
    description:
      "Deliver an external signal to a suspended run and resume it (exactly-once).",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The suspended run to resume." },
        signal: {
          type: "string",
          description: "The external signal name to deliver.",
        },
        data: { description: "The signal's JSON payload (optional)." },
        operatorToken: {
          type: "string",
          description:
            "Operator token, required if the run's target is protected.",
        },
      },
      required: ["runId"],
    },
    annotations: { title: "Signal run", destructiveHint: true },
  },
  {
    name: "resume_check",
    description:
      "Re-check suspended runs (predicate waits, timeouts). Omit runId to sweep all.",
    inputSchema: {
      type: "object",
      properties: {
        runId: {
          type: "string",
          description:
            "A single run to check; omit to sweep every suspended run.",
        },
        operatorToken: {
          type: "string",
          description: "Operator token, required for protected targets.",
        },
      },
    },
    annotations: { title: "Resume check", destructiveHint: true },
  },
  {
    name: "cancel_run",
    description:
      "Cancel a run and run its compensations (reverse order). Idempotent — a finished run is a no-op.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The run to cancel." },
        operatorToken: {
          type: "string",
          description:
            "Operator token, required if the run's target is protected.",
        },
      },
      required: ["runId"],
    },
    annotations: { title: "Cancel run", destructiveHint: true },
  },
];

/**
 * The run-state tool definitions: the read tools always, plus the mutating ones
 * when `includeMutating` (i.e. execution is enabled).
 */
export function runStateToolDefs(includeMutating: boolean): McpTool[] {
  return includeMutating ? [...READ_TOOLS, ...MUTATING_TOOLS] : [...READ_TOOLS];
}

/** The name of every run-state tool, for dispatch and audit classification. */
export const RUN_STATE_TOOL_NAMES: readonly string[] = [
  ...READ_TOOLS,
  ...MUTATING_TOOLS,
].map((t) => t.name);

/** Whether `name` is one of the mutating run-state tools (audited, gated). */
export function isMutatingRunTool(name: string): boolean {
  return name === "signal_run" || name === "resume_check" ||
    name === "cancel_run";
}

/** Read an optional string argument, or `undefined` when absent/not a string. */
function stringArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

/** A positive-integer argument (a JSON number), or `undefined` when absent/invalid. */
function positiveIntArg(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/** Render a value as a pretty-printed JSON tool result. */
function jsonResult(value: unknown, isError = false): RunToolResult {
  return { text: JSON.stringify(value, null, 2), isError };
}

/** Turn a typed failure into structured JSON content (never a flattened string). */
function structuredError(error: unknown, runId: string): RunToolResult {
  if (error instanceof AlreadyResumedError) {
    return jsonResult(
      {
        error: "already_resumed",
        runId: error.runId,
        by: error.by,
        at: error.at,
      },
      true,
    );
  }
  if (error instanceof LockConflictError) {
    return jsonResult(
      { error: "lock_conflict", holder: error.holder, guidance: error.message },
      true,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return jsonResult({ error: "run_failed", runId, message }, true);
}

/**
 * Dispatch a run-state tool call, or return `null` when `name` is not one. The
 * caller has already gated the mutating tools behind execution being enabled.
 */
export async function callRunStateTool(
  deps: RunToolDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<RunToolResult | null> {
  if (name === "list_runs") return await listRuns(deps, args);
  if (name === "show_run") return await showRun(deps, args);
  if (name === "signal_run") return await signalRun(deps, args);
  if (name === "resume_check") return await resumeCheckTool(deps, args);
  if (name === "cancel_run") return await cancelRunTool(deps, args);
  return null;
}

/** `list_runs`: return the summary array (filtered), newest first. */
async function listRuns(
  deps: RunToolDeps,
  args: Record<string, unknown>,
): Promise<RunToolResult> {
  const query: RunQuery = {};
  const status = stringArg(args, "status");
  if (status !== undefined) {
    if (!isRunStatus(status)) {
      return jsonResult(
        { error: "invalid_status", status, allowed: RUN_STATUS_NAMES },
        true,
      );
    }
    query.status = status;
  }
  const target = stringArg(args, "target");
  if (target !== undefined) query.target = target;
  const since = stringArg(args, "since");
  if (since !== undefined) query.since = since;
  const limit = positiveIntArg(args, "limit");
  if (limit !== undefined) query.limit = limit;
  return jsonResult(await deps.store.listRuns(query));
}

/** `show_run`: return one run's full record, or a structured not-found. */
async function showRun(
  deps: RunToolDeps,
  args: Record<string, unknown>,
): Promise<RunToolResult> {
  const runId = stringArg(args, "runId");
  if (runId === undefined) {
    return jsonResult({ error: "missing_argument", argument: "runId" }, true);
  }
  const loaded = await deps.store.getRun(runId);
  if (loaded === null) return jsonResult({ error: "no_run", runId }, true);
  return jsonResult(loaded.record);
}

/** `signal_run`: deliver a signal and resume the run, exactly once. */
async function signalRun(
  deps: RunToolDeps,
  args: Record<string, unknown>,
): Promise<RunToolResult> {
  const runId = stringArg(args, "runId");
  if (runId === undefined) {
    return jsonResult({ error: "missing_argument", argument: "runId" }, true);
  }
  // A resume runs the run's target code, so it is gated by the same allow-list
  // and operator-token policy as a `run:` tool.
  const loaded = await deps.store.getRun(runId);
  if (loaded === null) return jsonResult({ error: "no_run", runId }, true);
  const denied = deps.authorize(loaded.record.rootTarget, args);
  if (denied !== null) {
    return jsonResult({ error: "unauthorized", reason: denied, runId }, true);
  }
  const data: JsonValue | undefined = "data" in args
    ? toJsonValue(args.data ?? null)
    : undefined;
  try {
    const result = await resumeRun(deps.build, {
      runId,
      signal: stringArg(args, "signal"),
      data,
      stateStore: deps.store,
      actor: deps.actor,
      readEnv: deps.readEnv,
      silent: true,
    });
    if (result.ok) {
      return jsonResult({
        ok: true,
        runId,
        suspended: result.suspended === true,
        executed: result.executed,
      });
    }
    return structuredError(result.error, runId);
  } catch (error) {
    return structuredError(error, runId);
  }
}

/** `resume_check`: re-check one or all suspended runs the caller may resume. */
async function resumeCheckTool(
  deps: RunToolDeps,
  args: Record<string, unknown>,
): Promise<RunToolResult> {
  const runId = stringArg(args, "runId");
  // Resolve the candidate runs, then keep only those the caller is authorised to
  // resume (same allow-list/operator-token gate as a run). A single-id request
  // that is denied errors; a sweep silently skips runs it may not touch.
  let candidates: string[];
  if (runId !== undefined) {
    const loaded = await deps.store.getRun(runId);
    if (loaded === null) return jsonResult({ error: "no_run", runId }, true);
    const denied = deps.authorize(loaded.record.rootTarget, args);
    if (denied !== null) {
      return jsonResult({ error: "unauthorized", reason: denied, runId }, true);
    }
    candidates = [runId];
  } else {
    const suspended = await deps.store.listRuns({ status: "suspended" });
    candidates = suspended
      .filter((s) => deps.authorize(s.rootTarget, args) === null)
      .map((s) => s.id);
  }
  let checked = 0;
  let failed = 0;
  for (const id of candidates) {
    try {
      const result = await resumeCheck(deps.build, {
        runId: id,
        stateStore: deps.store,
        actor: deps.actor,
        readEnv: deps.readEnv,
        silent: true,
      });
      checked += result.checked;
      failed += result.failed;
    } catch (error) {
      return structuredError(error, id);
    }
  }
  return jsonResult({ ok: failed === 0, checked, failed });
}

/** `cancel_run`: cancel a run and run its compensations, exactly like `zuke cancel`. */
async function cancelRunTool(
  deps: RunToolDeps,
  args: Record<string, unknown>,
): Promise<RunToolResult> {
  const runId = stringArg(args, "runId");
  if (runId === undefined) {
    return jsonResult({ error: "missing_argument", argument: "runId" }, true);
  }
  // Cancelling runs the run's compensation code, so it is gated by the same
  // allow-list and operator-token policy as a `run:` tool.
  const loaded = await deps.store.getRun(runId);
  if (loaded === null) return jsonResult({ error: "no_run", runId }, true);
  const denied = deps.authorize(loaded.record.rootTarget, args);
  if (denied !== null) {
    return jsonResult({ error: "unauthorized", reason: denied, runId }, true);
  }
  try {
    const result = await cancelRun(deps.build, {
      runId,
      stateStore: deps.store,
      actor: deps.actor,
      readEnv: deps.readEnv,
      silent: true,
    });
    return jsonResult({
      ok: result.failures.length === 0,
      runId,
      status: result.status,
      noop: result.noop,
      compensated: result.compensated,
      failures: result.failures,
    });
  } catch (error) {
    return structuredError(error, runId);
  }
}
