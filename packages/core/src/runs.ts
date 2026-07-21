/**
 * The `zuke runs` command: list persisted run records and show one run's full
 * detail from a {@link "./state/store.ts".StateStore}, reconstructing a run's
 * status after its process has exited. This is the read side of durable run
 * state (the write side lives in the executor and `zuke resume`).
 *
 * @module
 */

import type { Build } from "./build.ts";
import { defaultReadEnv } from "./internal.ts";
import { absolutePath } from "./path.ts";
import { findConfigDir, pathExists } from "./config.ts";
import { defaultStateHost, type StateStore } from "./state/store.ts";
import { resolveStateStore } from "./state/resolve.ts";
import type {
  RunQuery,
  RunRecord,
  RunStatus,
  RunSummary,
  TargetRunState,
  TargetRunStatus,
} from "./state/types.ts";
import { formatDuration } from "./render.ts";

/** Inputs for {@link runsCommand}. */
export interface RunsOptions {
  /** The sub-action: `list` (the default), `show`, or `prune`. */
  action?: string;
  /** The run id to show; required by the `show` sub-action. */
  runId?: string;
  /** Emit JSON (a summary array, or the whole record) instead of a human view. */
  json?: boolean;
  /** With `list`, report aggregate counts (total + per status) instead of rows. */
  counts?: boolean;
  /** Filters for `list` — status, a target in the run, a creation time, a limit. */
  query?: RunQuery;
  /**
   * `prune`: keep runs created within this many milliseconds of now; older
   * terminal runs become eligible. Omitted means no age rule.
   */
  keepMs?: number;
  /** `prune`: always keep the newest N terminal runs, regardless of age. */
  keepLast?: number;
  /** `prune`: report what would be pruned without deleting (CLI `--dry-run`). */
  dryRun?: boolean;
  /** The wall clock for `prune`'s age cutoff (epoch ms); defaults to `Date.now`. */
  now?: () => number;
  /**
   * Store override, resolved like a run (explicit → `stateStore()` → env →
   * `.zuke/runs`); `false` disables state. Tests inject a store here.
   */
  stateStore?: StateStore | false;
  /** Reads an environment variable (injectable for tests). */
  readEnv?: (name: string) => string | undefined;
}

/** The run statuses past which nothing more happens — the only prunable ones. */
const TERMINAL_STATUSES: readonly RunStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

/** Whether a run has reached a terminal (prunable) status. */
function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Options for {@link selectRunsToPrune}. */
export interface PruneRules {
  /** Keep runs created within this many ms of `nowMs`; omitted means no age rule. */
  keepMs?: number;
  /** Always keep the newest N terminal runs; omitted means no count rule. */
  keepLast?: number;
}

/**
 * From `summaries` (newest first), pick the ids of runs to prune: a run is
 * removed only if it is **terminal** and matches **neither** retention rule —
 * it is beyond the newest `keepLast` and older than the `keepMs` window. A
 * non-terminal run (suspended, running, cancelling) is never selected — a run
 * waiting days for a human is the point of the system. With no rule given,
 * every terminal run qualifies, so callers must supply at least one.
 */
export function selectRunsToPrune(
  summaries: readonly RunSummary[],
  rules: PruneRules,
  nowMs: number,
): string[] {
  const cutoff = rules.keepMs === undefined ? undefined : nowMs - rules.keepMs;
  const terminal = summaries.filter((s) => isTerminalStatus(s.status));
  const toPrune: string[] = [];
  terminal.forEach((s, index) => {
    if (rules.keepLast !== undefined && index < rules.keepLast) return;
    if (cutoff !== undefined) {
      const created = Date.parse(s.createdAt);
      // An unparseable timestamp is kept, never pruned (fail safe).
      if (Number.isNaN(created) || created >= cutoff) return;
    }
    toPrune.push(s.id);
  });
  return toPrune;
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
    if (options.counts) {
      const counts = aggregateRunCounts(summaries);
      console.log(
        options.json
          ? JSON.stringify(counts, null, 2)
          : formatRunCounts(counts),
      );
      return 0;
    }
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
  if (action === "prune") return await pruneRuns(store, options);
  console.error("Usage: zuke runs <list|show|prune> [<run-id>]");
  return 1;
}

/**
 * `zuke runs prune`: delete terminal runs that match neither retention rule,
 * keeping non-terminal runs and everything within `--keep`/`--keep-last`. At
 * least one rule is required, so an empty `prune` can't wipe the store. With
 * `--dry-run`, reports what would be pruned without deleting.
 */
async function pruneRuns(
  store: StateStore,
  options: RunsOptions,
): Promise<number> {
  if (options.keepMs === undefined && options.keepLast === undefined) {
    console.error(
      "Usage: zuke runs prune [--keep <duration>] [--keep-last <n>]\n" +
        "  Give at least one retention rule — prune never deletes everything by default.",
    );
    return 1;
  }
  const now = options.now ?? Date.now;
  // List everything, newest first (no limit): pruning needs the full set to
  // apply the newest-N and age rules across all runs.
  const summaries = await store.listRuns({});
  const ids = selectRunsToPrune(
    summaries,
    { keepMs: options.keepMs, keepLast: options.keepLast },
    now(),
  );
  if (options.dryRun) {
    console.log(
      options.json
        ? JSON.stringify({ wouldPrune: ids }, null, 2)
        : `Would prune ${ids.length} run(s)${idList(ids)}.`,
    );
    return 0;
  }
  for (const id of ids) await store.deleteRun(id);
  console.log(
    options.json
      ? JSON.stringify({ pruned: ids }, null, 2)
      : `Pruned ${ids.length} run(s)${idList(ids)}.`,
  );
  return 0;
}

/** A short trailing ` (id, id, …)` list, or empty when nothing was selected. */
function idList(ids: readonly string[]): string {
  return ids.length === 0 ? "" : `: ${ids.join(", ")}`;
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

/** Aggregate run counts for `runs list --counts`. */
export interface RunCounts {
  /** The total number of runs matched by the query. */
  total: number;
  /** The count per run status, keyed in ascending status-name order. */
  byStatus: Record<string, number>;
}

/**
 * Tally `summaries` into a total and per-status counts. The `byStatus` keys are
 * inserted in ascending status-name order, so the JSON output is deterministic.
 */
export function aggregateRunCounts(
  summaries: readonly RunSummary[],
): RunCounts {
  const tally = new Map<string, number>();
  for (const s of summaries) {
    tally.set(s.status, (tally.get(s.status) ?? 0) + 1);
  }
  const byStatus: Record<string, number> = {};
  const sorted = [...tally].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
  );
  for (const [status, count] of sorted) byStatus[status] = count;
  return { total: summaries.length, byStatus };
}

/** Render `runs list --counts`: a total and one line per present status. */
export function formatRunCounts(counts: RunCounts): string {
  if (counts.total === 0) return "No runs found.";
  const entries = Object.entries(counts.byStatus);
  const width = Math.max(...entries.map(([status]) => status.length));
  const lines = entries.map(([status, n]) => `  ${status.padEnd(width)}  ${n}`);
  return [`Total: ${counts.total}`, ...lines].join("\n");
}

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
