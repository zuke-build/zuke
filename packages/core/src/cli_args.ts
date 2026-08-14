// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The CLI's argument parser: the {@link ParsedArgs} shape every command reads,
 * {@link parseArgs} that fills it, and the "did you mean" machinery behind an
 * unknown flag. Pure — no I/O, no console — so `cli.ts` stays about dispatch.
 *
 * Module-internal: `cli.ts` and `cli_commands.ts` are its only callers, and
 * `mod.ts` exports neither this module nor anything from it.
 *
 * @module
 */

import {
  BUILTIN_FLAGS,
  CANCEL_COMMAND,
  COMPLETIONS_COMMAND,
  DOC_COMMAND,
  GENERATE_CI_COMMAND,
  GRAPH_COMMAND,
  MCP_COMMAND,
  REGISTER_COMMAND,
  RESUME_COMMAND,
  RUNS_COMMAND,
} from "./cli_spec.ts";

/** `completions` sub-action: print the script to stdout. */
export const PRINT_SUBCOMMAND = "print";

/** `completions` sub-action: write the script and wire it into the shell. */
export const INSTALL_SUBCOMMAND = "install";

/** Output format for the `graph` command: a terminal listing or an HTML page. */
export type GraphOutput = "text" | "html";

/** Normalise an `--output` value; anything but `html` is treated as `text`. */
function parseOutput(value: string): GraphOutput {
  return value === "html" ? "html" : "text";
}

/** A declared parameter's CLI flag and whether it is a value-less boolean. */
export interface ParamFlag {
  /** The parameter's property name. */
  name: string;
  /** The CLI flag (without leading dashes). */
  flag: string;
  /** Whether the parameter is a boolean (its flag takes no value). */
  boolean: boolean;
  /** Whether the parameter is a list: repeated flags accumulate (comma-joined). */
  array: boolean;
}

/** Parsed command-line arguments. */
export interface ParsedArgs {
  /** The requested target, if a positional argument was given. */
  target?: string;
  /** Dependencies to skip (`--skip <dep>`, repeatable). */
  skip: string[];
  list: boolean;
  /** Emit the build surface as JSON (`--json`) instead of human text. */
  json: boolean;
  /** The `graph` command was requested. */
  graph: boolean;
  /** The `generate-ci` command was requested. */
  generateCi: boolean;
  /** The `completions` command was requested. */
  completions: boolean;
  /** The `mcp` command was requested (run an MCP server over the build). */
  mcp: boolean;
  /** Allow `mcp` to execute targets, not just inspect them (`--allow-run`). */
  allowRun: boolean;
  /** Restrict `mcp` run tools to targets matching these globs (`--allow-run=<list>`). */
  allowRunPatterns?: string[];
  /** Targets whose `mcp` run tool needs an operator token (`--protect <list>`). */
  protectPatterns?: string[];
  /** Extra origins allowed to call the `mcp --http` transport (`--allowed-origin`). */
  allowedOrigins?: string[];
  /** Require `confirm:true` before a destructive `mcp` run (`--confirm-destructive`). */
  confirmDestructive: boolean;
  /** Serve `mcp` over the build registry (dynamic discovery) rather than one build (`--registry`). */
  mcpRegistry: boolean;
  /** Cap on concurrent registry run-tool spawns (`--max-concurrent-runs`). */
  maxConcurrentRuns?: number;
  /** Serve `mcp` over HTTP on this `<host:port>` instead of stdio (`--http`). */
  httpAddr?: string;
  /** The `completions` sub-action (`install` or `print`); the first positional. */
  completionsAction?: string;
  /** The shell argument to `completions` (the positional after the sub-action). */
  shell?: string;
  /** Verify (rather than write) generated files (`--check`); fail if stale. */
  check: boolean;
  /** Graph output format (`--output`); defaults to `text`. */
  output: GraphOutput;
  /** Open the HTML graph in a browser (default true; `--no-open` clears). */
  open: boolean;
  /** Run independent targets concurrently (`--parallel[=N]`). */
  parallel?: boolean | number;
  /** Disable the incremental cache (`--no-cache`); undefined leaves it on. */
  cache?: boolean;
  /** Disable only the remote cache store (`--no-remote-cache`); undefined leaves it on. */
  remoteCache?: boolean;
  /** Restrict the run to targets affected since a git base (`--affected[=<base>]`). */
  affected: boolean;
  /** The git base revision for `--affected` (the `=<base>` value); undefined uses the default. */
  affectedBase?: string;
  /** Print the plan without running any target bodies (`--dry-run`). */
  dryRun: boolean;
  /** Persist durable run state to `.zuke/runs` when nothing else configures a store (`--state`). */
  state: boolean;
  /** Attribute the run to this actor in its state record (`--actor <name>`). */
  actor?: string;
  /** The `resume` command was requested (continue a suspended run). */
  resume: boolean;
  /** The run id to resume (the positional after `resume`). */
  resumeRunId?: string;
  /** Deliver this external signal on resume (`--signal <name>`). */
  signal?: string;
  /** The signal's JSON payload (`--data <json>`). */
  data?: string;
  /** Continue a resume even if the build graph changed (`--force-graph`). */
  forceGraph: boolean;
  /** Continue a resume even if the record lost a state write (`--resume-degraded`). */
  resumeDegraded: boolean;
  /** The `runs` command was requested (list/show persisted runs). */
  runs: boolean;
  /** The `runs` sub-action (`list` or `show`); the first positional after `runs`. */
  runsAction?: string;
  /** The run id to show (`runs show <id>`); the positional after the sub-action. */
  runsRunId?: string;
  /** With `runs list`, keep only runs with this status (`--status`). */
  runStatus?: string;
  /** With `runs list`, keep only runs whose graph has this target (`--target`). */
  runTarget?: string;
  /** With `runs list`, keep only runs created at/after this ISO-8601 time (`--since`). */
  since?: string;
  /** With `runs list`, return at most this many runs (`--limit`). */
  runLimit?: string;
  /** With `runs list`, report aggregate counts instead of rows (`--counts`). */
  runCounts?: boolean;
  /** With `runs prune`, keep runs newer than this age (`--keep`). */
  keep?: string;
  /** With `runs prune`, always keep the newest N terminal runs (`--keep-last`). */
  keepLast?: string;
  /** The `cancel` command was requested (cancel a run and run its compensations). */
  cancel: boolean;
  /** The run id to cancel (the positional after `cancel`). */
  cancelRunId?: string;
  /** The `register` command was requested (record this build in the registry). */
  register: boolean;
  /** The `doc` command was requested (print a package's API docs, isolated). */
  doc: boolean;
  /** The spec to document (the positional after `doc`): a `jsr:`/`npm:` URL or a path. */
  docSpec?: string;
  /** Raw parameter values from declared flags, keyed by property name. */
  values: Record<string, string>;
  help: boolean;
}

/** Parse a `--parallel=N` value (the inline text after `=`): a positive count, or `true`. */
function parseParallel(value: string): boolean | number {
  if (value === "") return true;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : true;
}

/** Parse a positive-integer flag value, or `undefined` when absent/invalid. */
export function parsePositiveInt(
  value: string | undefined,
): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Split a comma-separated flag value into trimmed, non-empty entries. */
function splitList(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter((entry) =>
    entry !== ""
  );
}

/**
 * Levenshtein edit distance between two strings, used only to power the
 * "did you mean" suggestions below — not exported, since it isn't part of the
 * CLI's public surface.
 */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from(
    { length: rows },
    () => new Array<number>(cols),
  );
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(
        dp[i - 1][j],
        dp[i][j - 1],
        dp[i - 1][j - 1],
      );
    }
  }
  return dp[a.length][b.length];
}

/**
 * The nearest match for `name` among `known` (flag names without their leading
 * dashes, or target names) within edit distance 2, or `undefined` if none is
 * close enough. A distance of 0 never counts: `name` *is* that candidate, and
 * naming a word as the fix for itself helps nobody. Ties go to whichever
 * candidate `known` lists first, so the suggestion is deterministic.
 */
export function nearestName(
  name: string,
  known: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDistance = 3; // only distances of 1 or 2 count as "close enough"
  for (const candidate of known) {
    const distance = editDistance(name, candidate);
    if (distance > 0 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The friendly error for a `--flag` that is neither a built-in flag nor a
 * declared build parameter: names the offending flag and, when one is close
 * enough (edit distance ≤ 2), suggests the flag it was probably meant to be.
 *
 * `arg` is the argument as typed, so a rejected `--flag=value` is quoted back in
 * full; `flag` is its name with the leading dashes and any `=value` stripped.
 * When that bare name *is* a known flag, the flag simply takes no inline value —
 * a distinct mistake with a distinct fix, so it gets its own message rather than
 * a "did you mean" pointing at the flag the operator already typed.
 */
function unknownFlagError(
  arg: string,
  flag: string,
  known: readonly string[],
): Error {
  if (arg !== `--${flag}` && known.includes(flag)) {
    return new Error(
      `Unknown flag "${arg}": "--${flag}" is a flag, but it does not take an ` +
        `inline "=value". Pass "--${flag}" on its own if it is a switch, or ` +
        `with its value as the next argument.`,
    );
  }
  const suggestion = nearestName(flag, known);
  const hint = suggestion !== undefined
    ? ` Did you mean "--${suggestion}"?`
    : " Run --help to see the available flags.";
  return new Error(`Unknown flag "--${flag}".${hint}`);
}

/**
 * How a built-in flag that takes a value applies it to the parse result — the
 * one axis that differs between otherwise identical `--flag value` /
 * `--flag=value` branches.
 */
interface ValueFlag {
  /** Apply the value taken from the next argument (`--flag value`). */
  readonly set: (parsed: ParsedArgs, value: string) => void;
  /**
   * Apply an inline `--flag=value`, when that form does something else than
   * {@link ValueFlag.set} — only `--allowed-origin`, whose inline form accepts a
   * comma-list while its space form takes a single origin.
   */
  readonly setInline?: (parsed: ParsedArgs, value: string) => void;
  /**
   * Whether the space form applies an explicit empty value (`--flag ""`, e.g.
   * from an unset CI variable) instead of dropping it as absent — so it reaches
   * the flag's validator and is rejected rather than silently ignored. Only a
   * missing token ever stays undefined. The inline form (`--flag=`) always
   * applies, empty or not.
   */
  readonly keepEmpty?: boolean;
}

/**
 * The built-in flags that take a value, mapped to how they store it: one table
 * in place of a near-identical pair of branches per flag.
 *
 * `--skip` is deliberately absent — it takes a value but has never accepted an
 * inline `--skip=lint`, which must keep reaching {@link unknownFlagError}.
 */
const VALUE_FLAGS: ReadonlyMap<string, ValueFlag> = new Map([
  ["actor", { set: (p, v) => (p.actor = v) }],
  ["signal", { set: (p, v) => (p.signal = v) }],
  ["data", { set: (p, v) => (p.data = v), keepEmpty: true }],
  ["status", { set: (p, v) => (p.runStatus = v) }],
  ["target", { set: (p, v) => (p.runTarget = v) }],
  ["since", { set: (p, v) => (p.since = v) }],
  ["limit", { set: (p, v) => (p.runLimit = v), keepEmpty: true }],
  ["keep", { set: (p, v) => (p.keep = v), keepEmpty: true }],
  ["keep-last", { set: (p, v) => (p.keepLast = v), keepEmpty: true }],
  ["protect", { set: (p, v) => (p.protectPatterns = splitList(v)) }],
  ["allowed-origin", {
    set: (p, v) => (p.allowedOrigins = [...p.allowedOrigins ?? [], v]),
    setInline: (p, v) => (p.allowedOrigins = [
      ...p.allowedOrigins ?? [],
      ...splitList(v),
    ]),
  }],
  ["max-concurrent-runs", {
    set: (p, v) => (p.maxConcurrentRuns = parsePositiveInt(v)),
    keepEmpty: true,
  }],
  ["http", { set: (p, v) => (p.httpAddr = v) }],
  ["output", { set: (p, v) => (p.output = parseOutput(v)) }],
]);

/**
 * Parse `zuke` arguments. Built-in flags are recognised first; `paramFlags`
 * lets the caller pass the build's declared parameter flags so their values are
 * collected. A `--flag` that is neither a built-in nor a declared parameter
 * throws, naming the flag and suggesting the nearest known flag if one is
 * close enough — unless `--help` is also on the line, in which case help wins,
 * since help is exactly what someone who mistyped a flag is asking for.
 *
 * @throws {Error} for an unrecognized `--flag`, when help was not requested.
 */
export function parseArgs(
  args: string[],
  paramFlags: ParamFlag[] = [],
): ParsedArgs {
  const parsed: ParsedArgs = {
    skip: [],
    list: false,
    json: false,
    graph: false,
    generateCi: false,
    completions: false,
    mcp: false,
    allowRun: false,
    check: false,
    output: "text",
    open: true,
    values: {},
    affected: false,
    dryRun: false,
    state: false,
    resume: false,
    forceGraph: false,
    resumeDegraded: false,
    runs: false,
    cancel: false,
    register: false,
    doc: false,
    confirmDestructive: false,
    mcpRegistry: false,
    help: false,
  };
  const byFlag = new Map<string, ParamFlag>();
  for (const pf of paramFlags) byFlag.set(pf.flag, pf);
  const knownFlags = [
    ...BUILTIN_FLAGS.map((f) => f.name.slice(2)),
    ...paramFlags.map((pf) => pf.flag),
  ];
  // The first unrecognized flag, thrown only after the whole line is parsed so
  // that a `--help` further along still wins.
  let unknown: Error | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--list" || arg === "-l") {
      parsed.list = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--no-open") {
      parsed.open = false;
    } else if (arg === "--no-cache") {
      parsed.cache = false;
    } else if (arg === "--no-remote-cache") {
      parsed.remoteCache = false;
    } else if (arg === "--affected") {
      parsed.affected = true;
    } else if (arg.startsWith("--affected=")) {
      parsed.affected = true;
      parsed.affectedBase = arg.slice("--affected=".length);
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--state") {
      parsed.state = true;
    } else if (arg === "--force-graph") {
      parsed.forceGraph = true;
    } else if (arg === "--resume-degraded") {
      parsed.resumeDegraded = true;
    } else if (arg === "--counts") {
      parsed.runCounts = true;
    } else if (arg === "--check") {
      parsed.check = true;
    } else if (arg === "--allow-run") {
      parsed.allowRun = true;
    } else if (arg.startsWith("--allow-run=")) {
      parsed.allowRun = true;
      parsed.allowRunPatterns = splitList(arg.slice("--allow-run=".length));
    } else if (arg === "--confirm-destructive") {
      parsed.confirmDestructive = true;
    } else if (arg === "--registry") {
      parsed.mcpRegistry = true;
    } else if (arg === "--parallel") {
      parsed.parallel = true;
    } else if (arg.startsWith("--parallel=")) {
      parsed.parallel = parseParallel(arg.slice("--parallel=".length));
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--skip") {
      // Not in VALUE_FLAGS on purpose: `--skip=dep` has never parsed, and must
      // keep falling through to unknownFlagError rather than gaining a form.
      const dep = args[++i];
      if (dep) parsed.skip.push(dep);
    } else if (arg === "--") {
      // A bare `--` is the conventional argument separator, and wrappers insert
      // one on their own (`deno run -A zuke.ts -- ci` passes it straight
      // through). This parser has no options-terminator semantics to apply, and
      // no target name starts with a dash, so skip it rather than reject it.
    } else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const flag = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const builtin = VALUE_FLAGS.get(flag);
      const pf = byFlag.get(flag);
      if (builtin !== undefined) {
        // A built-in flag that takes a value: consumed the same way for all of
        // them, with the flag's own setter deciding where the value lands. This
        // is checked before `byFlag`, so a built-in still wins over a declared
        // parameter of the same name.
        if (eq !== -1) {
          (builtin.setInline ?? builtin.set)(parsed, arg.slice(eq + 1));
        } else {
          const value = args[++i];
          if (
            value !== undefined &&
            (value !== "" || builtin.keepEmpty === true)
          ) {
            builtin.set(parsed, value);
          }
        }
      } else if (pf !== undefined) {
        let value: string | undefined;
        if (eq !== -1) value = arg.slice(eq + 1);
        else if (pf.boolean) value = "true";
        else value = args[++i];
        if (value !== undefined) {
          // Repeated list flags accumulate (comma-joined); others overwrite.
          parsed.values[pf.name] = pf.array && pf.name in parsed.values
            ? `${parsed.values[pf.name]},${value}`
            : value;
        }
      } else {
        unknown ??= unknownFlagError(arg, flag, knownFlags);
      }
    } else if (
      parsed.completions && parsed.completionsAction === undefined
    ) {
      // `completions` takes an explicit sub-action first (install or print)...
      parsed.completionsAction = arg;
    } else if (parsed.completions && parsed.shell === undefined) {
      // ...then the shell name.
      parsed.shell = arg;
    } else if (parsed.resume && parsed.resumeRunId === undefined) {
      // `resume` takes the run id as its positional.
      parsed.resumeRunId = arg;
    } else if (parsed.runs && parsed.runsAction === undefined) {
      // `runs` takes a sub-action first (list or show)...
      parsed.runsAction = arg;
    } else if (parsed.runs && parsed.runsRunId === undefined) {
      // ...then, for `show`, the run id.
      parsed.runsRunId = arg;
    } else if (parsed.cancel && parsed.cancelRunId === undefined) {
      // `cancel` takes the run id as its positional.
      parsed.cancelRunId = arg;
    } else if (parsed.doc && parsed.docSpec === undefined) {
      // `doc` takes the spec to document as its positional.
      parsed.docSpec = arg;
    } else if (
      parsed.target === undefined && !parsed.graph && !parsed.generateCi &&
      !parsed.completions && !parsed.mcp && !parsed.resume && !parsed.runs &&
      !parsed.cancel && !parsed.register && !parsed.doc
    ) {
      if (arg === GRAPH_COMMAND) parsed.graph = true;
      else if (arg === GENERATE_CI_COMMAND) parsed.generateCi = true;
      else if (arg === COMPLETIONS_COMMAND) parsed.completions = true;
      else if (arg === MCP_COMMAND) parsed.mcp = true;
      else if (arg === RESUME_COMMAND) parsed.resume = true;
      else if (arg === RUNS_COMMAND) parsed.runs = true;
      else if (arg === CANCEL_COMMAND) parsed.cancel = true;
      else if (arg === REGISTER_COMMAND) parsed.register = true;
      else if (arg === DOC_COMMAND) parsed.doc = true;
      else parsed.target = arg;
    }
  }
  if (unknown !== undefined && !parsed.help) throw unknown;
  return parsed;
}
