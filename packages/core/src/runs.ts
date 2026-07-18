/**
 * The `zuke runs` command: list persisted run records and show one run's full
 * detail from a {@link "./state/store.ts".StateStore}, reconstructing a run's
 * status after its process has exited. This is the read side of durable run
 * state (the write side lives in the executor and `zuke resume`).
 *
 * @module
 */

import type { Build } from "./build.ts";
import { absolutePath } from "./path.ts";
import { findConfigDir, pathExists } from "./config.ts";
import { defaultStateHost, type StateStore } from "./state/store.ts";
import { resolveStateStore } from "./state/resolve.ts";
import type {
  RunQuery,
  RunRecord,
  RunSummary,
  TargetRunState,
  TargetRunStatus,
} from "./state/types.ts";
import { formatDuration } from "./render.ts";

/** Inputs for {@link runsCommand}. */
export interface RunsOptions {
  /** The sub-action: `list` (the default) or `show`. */
  action?: string;
  /** The run id to show; required by the `show` sub-action. */
  runId?: string;
  /** Emit JSON (a summary array, or the whole record) instead of a human view. */
  json?: boolean;
  /** Filters for `list` — status, a target in the run, a creation time. */
  query?: RunQuery;
  /**
   * Store override, resolved like a run (explicit → `stateStore()` → env →
   * `.zuke/runs`); `false` disables state. Tests inject a store here.
   */
  stateStore?: StateStore | false;
  /** Reads an environment variable (injectable for tests). */
  readEnv?: (name: string) => string | undefined;
}

/** Read an environment variable, treating missing env access as unset. */
function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** Resolve the store for a `runs` query — like a run, but always defaulting on. */
function resolveRunsStore(
  option: StateStore | false | undefined,
  build: Build,
  readEnv: (name: string) => string | undefined,
): StateStore | undefined {
  return resolveStateStore(option, build.stateStore(), {
    readEnv,
    host: defaultStateHost,
    defaultDir: absolutePath(
      findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd(),
    )(".zuke", "runs").path,
    enableDefault: true,
  });
}

/**
 * Run `zuke runs list`/`show`, printing to the console and resolving to a
 * process exit code (0 success, 1 on a misuse or missing run/store).
 */
export async function runsCommand(
  build: Build,
  options: RunsOptions,
): Promise<number> {
  const readEnv = options.readEnv ?? defaultReadEnv;
  const store = resolveRunsStore(options.stateStore, build, readEnv);
  if (store === undefined) {
    console.error(
      "runs: no state store is configured. Set ZUKE_STATE_DIR / " +
        "ZUKE_STATE_URL, override stateStore(), or run a build with --state first.",
    );
    return 1;
  }

  const action = options.action ?? "list";
  if (action === "list") {
    const summaries = await store.listRuns(options.query ?? {});
    console.log(
      options.json
        ? JSON.stringify(summaries, null, 2)
        : formatRunList(summaries),
    );
    return 0;
  }
  if (action === "show") {
    if (options.runId === undefined) {
      console.error("Usage: zuke runs show <run-id>");
      return 1;
    }
    const loaded = await store.getRun(options.runId);
    if (loaded === null) {
      console.error(`runs: no run "${options.runId}" found in the store.`);
      return 1;
    }
    console.log(
      options.json
        ? JSON.stringify(loaded.record, null, 2)
        : formatRunDetail(loaded.record),
    );
    return 0;
  }
  console.error("Usage: zuke runs <list|show> [<run-id>]");
  return 1;
}

/** A single-glyph status marker, kept ASCII so it renders in any terminal/log. */
const STATUS_MARK: Record<TargetRunStatus, string> = {
  pending: "·",
  running: "»",
  waiting: "~",
  succeeded: "+",
  failed: "x",
  skipped: "-",
};

/** Render `runs list`: one row per run, newest first (as the store returns them). */
export function formatRunList(summaries: readonly RunSummary[]): string {
  if (summaries.length === 0) return "No runs found.";
  const rows = summaries.map((s) => [
    s.id,
    s.status,
    s.rootTarget,
    s.actor,
    s.createdAt,
  ]);
  const headers = ["ID", "STATUS", "TARGET", "ACTOR", "CREATED"];
  const widths = headers.map((h, col) =>
    Math.max(h.length, ...rows.map((r) => r[col].length))
  );
  const line = (cells: string[]) =>
    cells.map((c, col) => c.padEnd(widths[col])).join("  ").trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

/** The elapsed time of a target, when both timestamps are present and parse. */
function targetDuration(state: TargetRunState): string | undefined {
  if (state.startedAt === undefined || state.endedAt === undefined) {
    return undefined;
  }
  const ms = Date.parse(state.endedAt) - Date.parse(state.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : undefined;
}

/** The trailing note for one target line: a duration, error, or wait descriptor. */
function targetNote(state: TargetRunState): string {
  if (state.status === "failed" && state.error !== undefined) {
    return `  ${state.error}`;
  }
  if (state.status === "waiting" && state.waitingFor !== undefined) {
    const { trigger, deadline } = state.waitingFor;
    const until = deadline !== undefined ? ` (deadline ${deadline})` : "";
    return `  waiting for ${trigger}${until}`;
  }
  const duration = targetDuration(state);
  return duration !== undefined ? `  ${duration}` : "";
}

/** Render `runs show <id>`: the run header, parameters, targets, and signals. */
export function formatRunDetail(record: RunRecord): string {
  const lines = [
    `Run ${record.id}`,
    `  build:    ${record.build}`,
    `  target:   ${record.rootTarget}`,
    `  status:   ${record.status}`,
    `  actor:    ${record.actor}`,
    `  created:  ${record.createdAt}`,
    `  updated:  ${record.updatedAt}`,
  ];

  const params = Object.entries(record.params);
  if (params.length > 0) {
    lines.push("", "Parameters:");
    for (const [name, value] of params) lines.push(`  ${name} = ${value}`);
  }

  lines.push("", "Targets:");
  const entries = Object.entries(record.targets);
  if (entries.length === 0) {
    lines.push("  (none recorded)");
  } else {
    const width = Math.max(...entries.map(([name]) => name.length));
    for (const [name, state] of entries) {
      lines.push(
        `  ${STATUS_MARK[state.status]} ${name.padEnd(width)}  ` +
          `${state.status}${targetNote(state)}`,
      );
    }
  }

  const signals = Object.entries(record.signals);
  if (signals.length > 0) {
    lines.push("", "Signals:");
    for (const [name, sig] of signals) {
      lines.push(`  ${name}  (received ${sig.receivedAt})`);
    }
  }

  if (record.events.length > 0) {
    lines.push("", "Audit:");
    for (const event of record.events) {
      const detail = event.detail !== undefined ? `  ${event.detail}` : "";
      lines.push(
        `  ${event.at}  ${event.tool}  ${event.actor}  ` +
          `${event.outcome}${detail}`,
      );
    }
  }

  return lines.join("\n");
}
