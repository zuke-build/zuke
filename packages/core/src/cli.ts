// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The CLI surface: argument parsing, `--list`/`--help`/`graph`, and the public
 * {@link run} entry point that drives a build from `zuke.ts`.
 */

import { type Build, discoverGroups, discoverTargets } from "./build.ts";
import { cliReporter, printJson } from "./reporter.ts";
import { discoverCiFiles, syncCiFiles } from "./ci.ts";
import { isEntryModule } from "./entry.ts";
import { messageOf } from "./internal.ts";
import { forceTarget } from "./force.ts";
import { denoExecutable, isCI } from "./host.ts";
import { GraphError, validateGraph } from "./graph.ts";
import { InsecureBackendUrlError } from "./http.ts";
import { execute, type Reporter } from "./executor.ts";
import type { Renderer } from "./renderer.ts";
import {
  defaultGraphHost,
  graphCommand,
  type GraphHost,
} from "./graph_view.ts";
import { findOutdated, formatOutdated } from "./outdated.ts";
import {
  type AnyParameter,
  discoverParameters,
  flagOf,
  ParameterError,
} from "./params.ts";
import type { JsonValue, TargetBuilder } from "./target.ts";
import type { Plugin } from "./plugin.ts";
import {
  COMPLETION_SHELLS,
  type CompletionShell,
  formatCompletions,
  isCompletionShell,
} from "./completions.ts";
import { resolveDocSpec } from "./doc_spec.ts";
import { VERSION } from "./version.ts";
import {
  BUILTIN_FLAG_NAMES,
  BUILTIN_FLAGS,
  type BuiltinFlag,
  CANCEL_COMMAND,
  COMPLETIONS_COMMAND,
  DEFAULT_TARGET,
  DOC_COMMAND,
  FORCE_COMMAND,
  GENERATE_CI_COMMAND,
  GRAPH_COMMAND,
  MCP_COMMAND,
  OUTDATED_COMMAND,
  REGISTER_COMMAND,
  RESERVED_COMMANDS,
  RESUME_COMMAND,
  RUNS_COMMAND,
} from "./cli_spec.ts";
import { type HttpAddress, serveMcp } from "./mcp/command.ts";
import { cancelRun } from "./cancel.ts";
import { resumeCheck, resumeRun } from "./resume.ts";
import { runsCommand } from "./runs.ts";
import { parseDuration } from "./duration.ts";
import { registerCommand } from "./registry/register.ts";
import {
  ACTOR_KINDS,
  FORCED_OUTCOMES,
  isRunStatus,
  RUN_STATUS_NAMES,
  type RunQuery,
} from "./state/types.ts";
import {
  installCompletions,
  type InstallOptions,
} from "./completions_install.ts";
import { describeBuildSurface } from "./describe.ts";
import {
  formatUpdate,
  type UpdateOptions,
  updateOutdated,
} from "./outdated_update.ts";

/** `completions` sub-action: print the script to stdout. */
const PRINT_SUBCOMMAND = "print";

/** `completions` sub-action: write the script and wire it into the shell. */
const INSTALL_SUBCOMMAND = "install";

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
  /** Suppress the opening banner (`--no-banner`); undefined leaves it on. */
  banner?: boolean;
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
  /** Whether a person or a machine asked for the run (`--actor-kind <kind>`). */
  actorKind?: string;
  /** With `runs list`, keep only runs this actor started (`--initiator <name>`). */
  initiator?: string;
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
  /** True when the `force` command was requested. */
  force: boolean;
  /** The run id to cancel (the positional after `cancel`). */
  cancelRunId?: string;
  /** `force`: the run to act on (first positional). */
  forceRunId?: string;
  /** `force`: the target to settle (second positional). */
  forceTarget?: string;
  /** `force`: a third positional, which the command does not take. */
  forceExtra?: string;
  /** `force`: what the target settles to (`--outcome`). */
  outcome?: string;
  /** `force`: why it was forced (`--reason`). */
  reason?: string;
  /** The `register` command was requested (record this build in the registry). */
  register: boolean;
  /** The `doc` command was requested (print a package's API docs, isolated). */
  doc: boolean;
  /** The spec to document (the positional after `doc`): a `jsr:`/`npm:` URL or a path. */
  docSpec?: string;
  /** The `outdated` command was requested (report JSR packages behind their latest). */
  outdated: boolean;
  /** Exit non-zero when `outdated` found something (`--exit-code`). */
  exitCode: boolean;
  /** `outdated --update`: move the lock's resolved versions up, don't just report. */
  update: boolean;
  /**
   * Package names after `outdated`, restricting `--update` to those.
   *
   * Collected even without `--update` so `outdated @zuke/git --update` and
   * `outdated --update @zuke/git` mean the same thing, and so a name given to
   * a plain report is rejected rather than silently ignored.
   */
  updateOnly: string[];
  /** Raw parameter values from declared flags, keyed by property name. */
  values: Record<string, string>;
  help: boolean;
  /** Whether `--version` (or `-V`) asked for the core version and nothing else. */
  version: boolean;
}

/** Parse a `--parallel=N` value (the inline text after `=`): a positive count, or `true`. */
function parseParallel(value: string): boolean | number {
  if (value === "") return true;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : true;
}

/** Parse a positive-integer flag value, or `undefined` when absent/invalid. */
function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
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
function nearestName(
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
  ["actor-kind", { set: (p, v) => (p.actorKind = v) }],
  ["initiator", { set: (p, v) => (p.initiator = v) }],
  ["outcome", { set: (p, v) => (p.outcome = v) }],
  ["reason", { set: (p, v) => (p.reason = v), keepEmpty: true }],
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
    force: false,
    register: false,
    doc: false,
    outdated: false,
    exitCode: false,
    update: false,
    updateOnly: [],
    confirmDestructive: false,
    mcpRegistry: false,
    help: false,
    version: false,
  };
  const byFlag = new Map<string, ParamFlag>();
  for (const pf of paramFlags) byFlag.set(pf.flag, pf);
  const knownFlags = [
    ...BUILTIN_FLAG_NAMES,
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
    } else if (arg === "--no-banner") {
      parsed.banner = false;
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
    } else if (arg === "--exit-code") {
      parsed.exitCode = true;
    } else if (arg === "--update") {
      parsed.update = true;
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
    } else if (arg === "--version" || arg === "-V") {
      parsed.version = true;
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
    } else if (parsed.force && parsed.forceRunId === undefined) {
      // `force` takes the run id, then the target.
      parsed.forceRunId = arg;
    } else if (parsed.force && parsed.forceTarget === undefined) {
      parsed.forceTarget = arg;
    } else if (parsed.force && parsed.forceExtra === undefined) {
      // Kept rather than ignored, so a third positional is an error naming
      // itself instead of silently changing what the command does.
      parsed.forceExtra = arg;
    } else if (parsed.doc && parsed.docSpec === undefined) {
      // `doc` takes the spec to document as its positional.
      parsed.docSpec = arg;
    } else if (parsed.outdated) {
      // `outdated` takes any number of package names, narrowing --update to
      // them. Repeatable rather than comma-separated: a scoped name already
      // contains punctuation, and a shell splits arguments for us.
      parsed.updateOnly.push(arg);
    } else if (
      parsed.target === undefined && !parsed.graph && !parsed.generateCi &&
      !parsed.completions && !parsed.mcp && !parsed.resume && !parsed.runs &&
      !parsed.cancel && !parsed.force && !parsed.register && !parsed.doc &&
      !parsed.outdated
    ) {
      if (arg === GRAPH_COMMAND) parsed.graph = true;
      else if (arg === GENERATE_CI_COMMAND) parsed.generateCi = true;
      else if (arg === COMPLETIONS_COMMAND) parsed.completions = true;
      else if (arg === MCP_COMMAND) parsed.mcp = true;
      else if (arg === RESUME_COMMAND) parsed.resume = true;
      else if (arg === RUNS_COMMAND) parsed.runs = true;
      else if (arg === CANCEL_COMMAND) parsed.cancel = true;
      else if (arg === FORCE_COMMAND) parsed.force = true;
      else if (arg === REGISTER_COMMAND) parsed.register = true;
      else if (arg === DOC_COMMAND) parsed.doc = true;
      else if (arg === OUTDATED_COMMAND) parsed.outdated = true;
      else parsed.target = arg;
    }
  }
  if (unknown !== undefined && !parsed.help) throw unknown;
  return parsed;
}

/**
 * The reserved command this invocation named, if any.
 *
 * Derived from the parsed flags rather than re-scanning argv, so the two can
 * never disagree about which command was typed.
 */
function namedCommand(parsed: ParsedArgs): string | undefined {
  if (parsed.graph) return GRAPH_COMMAND;
  if (parsed.generateCi) return GENERATE_CI_COMMAND;
  if (parsed.completions) return COMPLETIONS_COMMAND;
  if (parsed.mcp) return MCP_COMMAND;
  if (parsed.resume) return RESUME_COMMAND;
  if (parsed.runs) return RUNS_COMMAND;
  if (parsed.cancel) return CANCEL_COMMAND;
  if (parsed.force) return FORCE_COMMAND;
  if (parsed.register) return REGISTER_COMMAND;
  if (parsed.doc) return DOC_COMMAND;
  if (parsed.outdated) return OUTDATED_COMMAND;
  return undefined;
}

/** Names of a target's direct dependencies, in declaration order. */
function depNames(t: TargetBuilder): string[] {
  return t.dependsOn_.map((d) => d.name_ ?? "?");
}

/** The program as it is typed, used in the usage lines help prints. */
const PROGRAM = "zuke";

/** Indent and wrap `text` to the help's column, under a `width`-wide label. */
function wrapDetail(text: string, indent: number, width = 80): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const paragraph of text.split("\n\n")) {
    if (lines.length > 0) lines.push("");
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line === "") line = word;
      else if (`${line} ${word}`.length + indent <= width) line += ` ${word}`;
      else {
        lines.push(pad + line);
        line = word;
      }
    }
    if (line !== "") lines.push(pad + line);
  }
  return lines;
}

/** One `  name   description` row, wrapped under the name column. */
function row(name: string, description: string, width: number): string[] {
  const label = `  ${name.padEnd(width)}  `;
  const wrapped = wrapDetail(description, label.length);
  if (wrapped.length === 0) return [label.trimEnd()];
  return [label + wrapped[0].trimStart(), ...wrapped.slice(1)];
}

/** The flags that apply to any run, rather than qualifying one command. */
function generalFlags(): BuiltinFlag[] {
  return BUILTIN_FLAGS.filter((f) => f.command === undefined);
}

/**
 * The main `--help`: what exists, one short line each, in labelled groups.
 *
 * Commands and options are separate sections rather than one list — they are
 * different kinds of thing, and interleaving them was what made the old help
 * hard to scan. The per-entry prose lives in each command's own help, so this
 * stays a map of the surface rather than the manual.
 */
function usageText(): string {
  const commandWidth = Math.max(
    ...RESERVED_COMMANDS.map((c) => c.name.length),
  );
  const flags = generalFlags();
  const flagWidth = Math.max(
    ...flags.map((f) => f.name.length),
    "<target>".length,
  );
  const lines = [
    `${PROGRAM} — code-first build automation`,
    "",
    "Usage:",
    `  ${PROGRAM} <target> [options]`,
    `  ${PROGRAM} <command> [options]`,
    `  ${PROGRAM} --list [--json]`,
    "",
    "Commands:",
  ];
  for (const command of RESERVED_COMMANDS) {
    lines.push(...row(command.name, command.description, commandWidth));
  }
  lines.push("", "Options:");
  lines.push(
    ...row(
      "<target>",
      "Run the target and its transitive dependencies.",
      flagWidth,
    ),
  );
  for (const flag of flags) {
    lines.push(...row(flag.name, flag.description, flagWidth));
  }
  lines.push(
    "",
    `Run \`${PROGRAM} <command> --help\` for a command's own options and detail.`,
  );
  return lines.join("\n");
}

/**
 * A single command's help: its usage, its explanation, and the flags that
 * qualify it — the detail the main help deliberately leaves out.
 *
 * Returns `undefined` for a name that is not a reserved command, so the caller
 * can fall back to the main help rather than print an empty page.
 */
export function formatCommandHelp(name: string): string | undefined {
  const command = RESERVED_COMMANDS.find((c) => c.name === name);
  if (command === undefined) return undefined;
  const lines = [`${PROGRAM} ${command.name} — ${command.description}`, ""];
  const usage = command.usage ?? [command.name];
  lines.push("Usage:");
  for (const line of usage) lines.push(`  ${PROGRAM} ${line}`);
  if (command.detail !== undefined) {
    lines.push("", ...wrapDetail(command.detail, 0));
  }
  const own = BUILTIN_FLAGS.filter((f) => f.command === command.name);
  if (own.length > 0) {
    const width = Math.max(...own.map((f) => f.name.length));
    lines.push("", "Options:");
    for (const flag of own) {
      lines.push(...row(flag.name, flag.detail ?? flag.description, width));
    }
  }
  return lines.join("\n");
}

/** Render `--help`, including the available targets and parameters. */
export function formatHelp(
  targets: Map<string, TargetBuilder>,
  params: Map<string, AnyParameter> = new Map(),
): string {
  return `${usageText()}\n\n${formatList(targets, params)}`;
}

/** Render `--list`: each target with its description and dependencies, then parameters. */
export function formatList(
  targets: Map<string, TargetBuilder>,
  params: Map<string, AnyParameter> = new Map(),
): string {
  // `unlisted` targets stay runnable by name but are hidden from the listing.
  const listed = new Map(
    [...targets].filter(([, t]) => !t.unlisted_),
  );
  const targetText = listed.size === 0
    ? "No targets defined."
    : renderTargets(listed);
  const paramText = formatParameters(params);
  return paramText === "" ? targetText : `${targetText}\n\n${paramText}`;
}

/** Render the target listing (non-empty). */
function renderTargets(targets: Map<string, TargetBuilder>): string {
  const width = Math.max(...[...targets.keys()].map((n) => n.length));
  const lines = ["Targets:"];
  for (const [name, t] of targets) {
    const deps = depNames(t);
    const desc = t.description_ ?? "";
    const fanOut = t.forEach_ !== undefined ? "  [fan-out]" : "";
    const suffix = deps.length ? `  (depends on: ${deps.join(", ")})` : "";
    lines.push(`  ${name.padEnd(width)}  ${desc}${fanOut}${suffix}`);
  }
  return lines.join("\n");
}

/** Render the parameters section, or `""` when no parameters are declared. */
function formatParameters(params: Map<string, AnyParameter>): string {
  if (params.size === 0) return "";
  const flags = [...params].map(([n, p]) => flagOf(n, p));
  const width = Math.max(...flags.map((f) => f.length));
  const lines = ["Parameters:"];
  for (const [name, p] of params) {
    const bits: string[] = [];
    if (p.required_) bits.push("required");
    if (p.options_ && p.options_.length > 0) {
      bits.push(`one of: ${p.options_.join(", ")}`);
    }
    const meta = bits.length > 0 ? `  (${bits.join("; ")})` : "";
    const desc = p.description_ ?? "";
    lines.push(`  --${flagOf(name, p).padEnd(width)}  ${desc}${meta}`);
  }
  return lines.join("\n");
}

/** Render the `graph` text output: an adjacency listing of `target → deps`. */
export function formatGraph(targets: Map<string, TargetBuilder>): string {
  if (targets.size === 0) return "No targets defined.";
  const lines = ["Dependency graph:"];
  for (const [name, t] of targets) {
    const deps = depNames(t);
    const group = t.group_?.name_ !== undefined
      ? `  [group: ${t.group_.name_}]`
      : "";
    const fanOut = t.forEach_ !== undefined ? "  [fan-out]" : "";
    const arrow = deps.length ? ` → ${deps.join(", ")}` : "";
    lines.push(`  ${name}${arrow}${group}${fanOut}`);
  }
  return lines.join("\n");
}

/**
 * Generate (or, with `check`, verify) the CI files a build declares, logging
 * what changed and returning a process exit code. This is the single code path
 * shared by the `generate-ci` command and the automatic regeneration that runs
 * with the build.
 *
 * @param quietWhenEmpty Stay silent when the build declares no CI files (used by
 *   the implicit on-run hook); the explicit command reports it instead.
 */
export async function syncCiConfig(
  build: Build,
  options: { check?: boolean; quietWhenEmpty?: boolean } = {},
): Promise<number> {
  const files = discoverCiFiles(build);
  if (files.length === 0) {
    if (!options.quietWhenEmpty) {
      cliReporter.info("No CI configuration is declared on this build.");
    }
    return 0;
  }
  const results = await syncCiFiles(files, { check: options.check });
  const stale: string[] = [];
  for (const { path, status } of results) {
    if (status === "written") cliReporter.info(`Generated ${path}`);
    else if (status === "stale") stale.push(path);
  }
  if (stale.length > 0) {
    cliReporter.error(
      `CI configuration is out of date: ${stale.join(", ")}.\n` +
        `Run \`zuke generate-ci\` and commit the result.`,
    );
    return 1;
  }
  return 0;
}

/** Optional inputs for {@link main} beyond the build class and argv. */
export interface MainOptions {
  /** Host used to render and open the HTML graph (injected in tests). */
  graphHost?: GraphHost;
  /** Runner for the `doc` command's `deno doc` spawn (injected in tests). */
  docRunner?: DocRunner;
  /**
   * Lock path, registry origin and `fetch` for the `outdated` command, plus
   * the re-resolution seam `--update` drives (injected in tests, which have
   * neither a lock, a network, nor a `deno` to spawn).
   */
  outdatedOptions?: UpdateOptions;
  /** Lifecycle observers to run alongside the build's own hooks. */
  plugins?: Plugin[];
  /** Overrides for `completions install` (home/config dir), injected in tests. */
  installOptions?: InstallOptions;
  /** Renderer for the build's banners and summary (see {@link RunOptions}). */
  renderer?: Renderer;
  /**
   * Where the run narrates its progress — the lock-wait notice, cancellation
   * lines, and the like. Injected in tests, which need to observe those lines
   * **while** a run is still going: `main` otherwise writes to the console, and
   * two concurrent runs cannot be told apart there.
   */
  reporter?: Reporter;
  /**
   * Cancel a running **build** when this signal aborts (its compensations run and
   * the record is marked cancelled). Applies only to a target run; other
   * commands ignore it. Tests inject one directly; {@link run} does not use it —
   * see {@link watchSignals}.
   */
  signal?: AbortSignal;
  /**
   * Install OS SIGINT/SIGTERM handlers that gracefully cancel a **build run**
   * (running its compensations; a second signal force-exits). Set by
   * {@link run}. Scoped to the target-run path on purpose, so a signal keeps its
   * default terminate behaviour for a long-lived `mcp` server and every other
   * command.
   */
  watchSignals?: boolean;
}

/**
 * Install the completion script for `shell` and report what changed, returning
 * a process exit code. Wraps {@link installCompletions} with friendly output
 * and turns a failure (e.g. no home directory) into a clean exit 1.
 */
async function installCompletionScript(
  shell: CompletionShell,
  targets: Map<string, TargetBuilder>,
  params: Map<string, AnyParameter>,
  options: MainOptions,
): Promise<number> {
  try {
    const result = await installCompletions(
      shell,
      targets,
      params,
      options.installOptions,
    );
    cliReporter.info(
      `Installed ${result.shell} completion to ${result.scriptPath}`,
    );
    if (result.rcPath === undefined) {
      cliReporter.info("Open a new shell (or restart fish) to load it.");
    } else if (result.alreadySourced) {
      cliReporter.info(
        `${result.rcPath} already sources it — nothing to change.`,
      );
    } else {
      cliReporter.info(
        `Added a source line to ${result.rcPath}; open a new shell to use it.`,
      );
    }
    return 0;
  } catch (error) {
    cliReporter.error(messageOf(error));
    return 1;
  }
}

/**
 * Drive a build to completion and resolve to a process exit code (0 success,
 * 1 failure). Does not call `Deno.exit`, so it is unit-testable; {@link run}
 * wraps it. Output goes through `console` unless `execute` options say otherwise.
 */
/** Largest accepted `--data` payload, guarding the run record against bloat. */
const MAX_SIGNAL_DATA_BYTES = 64 * 1024;

/**
 * Parse a `--data` JSON payload. Its *shape* is intentionally free-form (the
 * build interprets its own signals, like parameters), but its size is capped so
 * a webhook forwarding a large body can't bloat the persisted run record.
 */
function parseSignalData(raw: string | undefined): JsonValue | undefined {
  if (raw === undefined) return undefined;
  // Measure real UTF-8 bytes, not `raw.length` (UTF-16 code units) — a payload
  // of multi-byte characters can be well over the byte budget while its `.length`
  // is under it.
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > MAX_SIGNAL_DATA_BYTES) {
    throw new Error(
      `resume: --data payload is too large (${bytes} bytes; ` +
        `max ${MAX_SIGNAL_DATA_BYTES}).`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Don't echo the (possibly large or sensitive) payload back.
    throw new Error("resume: --data is not valid JSON.");
  }
}

/** Run the `resume` command: continue a suspended run, or `--check` all of them. */
async function runResume(
  build: Build,
  parsed: ParsedArgs,
  plugins?: Plugin[],
): Promise<number> {
  try {
    if (parsed.check) {
      const { checked, failed } = await resumeCheck(build, {
        runId: parsed.resumeRunId,
        params: parsed.values,
        actor: parsed.actor,
        forceGraph: parsed.forceGraph,
        resumeDegraded: parsed.resumeDegraded,
        plugins,
      });
      cliReporter.info(
        `Checked ${checked} suspended run(s); ${failed} failed.`,
      );
      return failed > 0 ? 1 : 0;
    }
    if (parsed.resumeRunId === undefined) {
      cliReporter.error(
        "Usage: zuke resume <run-id> [--signal <name>] [--data <json>]  |  " +
          "zuke resume --check [<run-id>]",
      );
      return 1;
    }
    const result = await resumeRun(build, {
      runId: parsed.resumeRunId,
      signal: parsed.signal,
      data: parseSignalData(parsed.data),
      params: parsed.values,
      actor: parsed.actor,
      forceGraph: parsed.forceGraph,
      resumeDegraded: parsed.resumeDegraded,
      banner: parsed.banner,
      plugins,
    });
    return result.ok ? 0 : 1;
  } catch (error) {
    cliReporter.error(messageOf(error));
    // A lost resume race (AlreadyResumedError) and any other failure both exit
    // non-zero; the message tells the operator what happened.
    return 1;
  }
}

/** Split a comma-separated flag value into trimmed, non-empty entries. */
function splitList(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter((entry) =>
    entry !== ""
  );
}

/** Parse a `--http` value: `<port>` (binds 127.0.0.1) or `<host:port>`. */
function parseHttpAddress(raw: string): HttpAddress {
  const colon = raw.lastIndexOf(":");
  const host = colon === -1 ? "127.0.0.1" : raw.slice(0, colon) || "127.0.0.1";
  const port = Number(colon === -1 ? raw : raw.slice(colon + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `mcp: invalid --http address "${raw}" — expected <port> or <host:port>.`,
    );
  }
  return { host, port };
}

/** Run the `mcp` command over stdio, or over HTTP when `--http` is given. */
async function runMcp(build: Build, parsed: ParsedArgs): Promise<number> {
  let http: HttpAddress | undefined;
  if (parsed.httpAddr !== undefined) {
    try {
      http = parseHttpAddress(parsed.httpAddr);
    } catch (error) {
      cliReporter.error(messageOf(error));
      return 1;
    }
  }
  return await serveMcp(build, {
    allowRun: parsed.allowRun,
    allowRunPatterns: parsed.allowRunPatterns,
    protectPatterns: parsed.protectPatterns,
    confirmDestructive: parsed.confirmDestructive,
    useRegistry: parsed.mcpRegistry,
    maxConcurrentRuns: parsed.maxConcurrentRuns,
    actor: parsed.actor,
    allowedOrigins: parsed.allowedOrigins,
    http,
  });
}

/** Run the `cancel` command: cancel a run and run its compensations. */
async function runCancel(build: Build, parsed: ParsedArgs): Promise<number> {
  if (parsed.cancelRunId === undefined) {
    cliReporter.error("Usage: zuke cancel <run-id> [--actor <name>]");
    return 1;
  }
  try {
    const result = await cancelRun(build, {
      runId: parsed.cancelRunId,
      actor: parsed.actor,
    });
    // A no-op (already-terminal run) and a completed cancellation both succeed;
    // a compensation that threw surfaces non-zero so the operator notices.
    return result.failures.length > 0 ? 1 : 0;
  } catch (error) {
    cliReporter.error(messageOf(error));
    return 1;
  }
}

/**
 * Run the `force` command: settle one target of a live run without running it.
 *
 * Validation lives in {@link forceTarget}, which re-checks it against a
 * freshly-read record on every compare-and-swap attempt; this layer only turns
 * the flags into options and the result into an exit code.
 */
async function runForce(build: Build, parsed: ParsedArgs): Promise<number> {
  if (parsed.forceExtra !== undefined) {
    cliReporter.error(
      `force: unexpected argument "${parsed.forceExtra}". ` +
        `Usage: zuke force <run-id> <target> --outcome skipped|succeeded ` +
        `[--reason <why>] [--actor <name>]`,
    );
    return 1;
  }
  if (parsed.forceRunId === undefined || parsed.forceTarget === undefined) {
    cliReporter.error(
      "Usage: zuke force <run-id> <target> --outcome skipped|succeeded " +
        "[--reason <why>] [--actor <name>]",
    );
    return 1;
  }
  const outcome = FORCED_OUTCOMES.find((o) => o === parsed.outcome);
  if (outcome === undefined) {
    cliReporter.error(
      `force: --outcome must be one of: ${FORCED_OUTCOMES.join(", ")}` +
        (parsed.outcome === undefined ? "." : ` (got "${parsed.outcome}").`),
    );
    return 1;
  }
  try {
    const result = await forceTarget(build, {
      runId: parsed.forceRunId,
      target: parsed.forceTarget,
      outcome,
      ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
      actor: parsed.actor,
    });
    // Escaped by the sink, not here. The reason inside this message is the
    // operator's, and in a scripted force it is often interpolated from a pull
    // request title or an issue body — but `forceTarget` deliberately returns it
    // unencoded, because the MCP tool hands the same message back inside a JSON
    // payload that must not carry a terminal's encoding. The printer decides.
    if (!result.ok) {
      cliReporter.error(result.message);
      return 1;
    }
    cliReporter.info(result.message);
    return 0;
  } catch (error) {
    cliReporter.error(messageOf(error));
    return 1;
  }
}

/** Run the `register` command: record this build in the build registry. */
async function runRegister(build: Build, parsed: ParsedArgs): Promise<number> {
  try {
    return await registerCommand(build, {
      actor: parsed.actor,
      json: parsed.json,
    });
  } catch (error) {
    cliReporter.error(messageOf(error));
    return 1;
  }
}

/**
 * Runs `deno doc <spec>` for the {@link runDoc} command — the injectable seam a
 * test swaps for a fake. Returns the process exit code.
 */
export type DocRunner = (spec: string) => Promise<number>;

/**
 * The default {@link DocRunner}: spawn Deno (via {@link denoExecutable}, so the
 * running Deno is used and no ambient one on `PATH` is assumed — unless this is
 * a compiled build, which is not Deno and has nothing else to run) as
 * `deno doc <spec>` with the working directory set to a fresh empty temp dir.
 * That isolation is the whole point — run from a Node repo, `deno doc` otherwise
 * resolves the repo's `node_modules/@types/*` and buries the API under dozens of
 * "Failed resolving types" warnings; an empty cwd has nothing to resolve.
 */
const defaultDocRunner: DocRunner = async (spec) => {
  const cwd = await Deno.makeTempDir({ prefix: "zuke-doc-" });
  try {
    const command = new Deno.Command(denoExecutable(), {
      args: ["doc", spec],
      cwd,
      stdout: "inherit",
      stderr: "inherit",
    });
    const { code } = await command.output();
    return code;
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
};

/**
 * Run the `doc` command: print a package's API docs via `deno doc`, isolated
 * from the repo so type-resolution noise doesn't bury the output. The argument
 * is resolved by {@link resolveDocSpec} — the same rule the installed `zuke`
 * applies, so `zuke doc core` and `./zuke doc core` name the same package
 * rather than one of them looking for a file. Errors resolve to a non-zero
 * exit with a friendly message, matching the other commands.
 */
async function runDoc(
  parsed: ParsedArgs,
  runner: DocRunner = defaultDocRunner,
): Promise<number> {
  const spec = parsed.docSpec;
  // An empty spec is a missing one, not a package name: resolving "" would
  // build `jsr:@zuke/` and hand deno doc a malformed specifier to complain
  // about. The installed CLI already refuses it, and these two agree.
  if (spec === undefined || spec === "") {
    cliReporter.error(
      "Usage: zuke doc <spec>   (e.g. zuke doc core, jsr:@zuke/deno, or ./mod.ts)",
    );
    return 1;
  }
  // A path is relative to the caller's cwd, but the runner documents from an
  // isolated empty directory — resolve it while that directory is still ours.
  try {
    return await runner(resolveDocSpec(spec, Deno.cwd()));
  } catch (error) {
    cliReporter.error(messageOf(error));
    return 1;
  }
}

/**
 * Run the `outdated` command: compare the versions the lock resolves against
 * the registry's latest, print the report, and — with `--exit-code` — report a
 * finding as a non-zero exit so a gate can fail on one.
 *
 * A failure to read the lock is an exit 1 with the reason, matching the other
 * commands. Being unable to reach the registry for a package is not: the
 * report still speaks for the rest, and names the ones it could not check —
 * which `--exit-code` also treats as a finding, since an unanswered question
 * is not a "yes".
 */
async function runOutdated(
  parsed: ParsedArgs,
  options: UpdateOptions = {},
): Promise<number> {
  try {
    if (parsed.update) return await runOutdatedUpdate(parsed, options);
    if (parsed.updateOnly.length > 0) {
      // Names only mean something to --update. Accepting them silently on a
      // plain report would read as a filter that quietly did nothing.
      cliReporter.error(
        `outdated: package names only apply with --update ` +
          `(got ${parsed.updateOnly.join(", ")}).`,
      );
      return 1;
    }
    const report = await findOutdated(options);
    cliReporter.info(formatOutdated(report));
    // A package that could not be checked counts as a failure under
    // --exit-code: a gate asking "are we current?" has not been told yes, and
    // an offline runner passing quietly is the silence this command exists to
    // break. Without the flag it stays a report and exits 0.
    const unresolved = report.behind.length + report.unchecked.length;
    return parsed.exitCode && unresolved > 0 ? 1 : 0;
  } catch (error) {
    cliReporter.error(messageOf(error));
    return 1;
  }
}

/**
 * Run `outdated --update`: move the lock's resolved versions up, then report
 * what moved and what its specifier held back.
 *
 * `--exit-code` answers a different question here than it does on the report.
 * There it means "something is behind"; after an update, being behind is the
 * expected state of anything a specifier pins, and failing on it would make
 * the flag impossible to use in the scheduled pipeline the command is meant
 * for. So it fails on what is *still* actionable: a package held back, or one
 * that could not be checked. A clean update exits 0.
 */
async function runOutdatedUpdate(
  parsed: ParsedArgs,
  options: UpdateOptions,
): Promise<number> {
  const only = parsed.updateOnly.length > 0 ? parsed.updateOnly : undefined;
  const report = await updateOutdated({ ...options, only });
  cliReporter.info(formatUpdate(report));
  const unresolved = report.held.length + report.unchecked.length;
  return parsed.exitCode && unresolved > 0 ? 1 : 0;
}

/** Run the `runs` command: build the query (validating `--status`) and dispatch. */
async function runRuns(build: Build, parsed: ParsedArgs): Promise<number> {
  const query: RunQuery = {};
  if (parsed.runStatus !== undefined) {
    if (!isRunStatus(parsed.runStatus)) {
      cliReporter.error(
        `runs: unknown --status "${parsed.runStatus}" ` +
          `(one of: ${RUN_STATUS_NAMES.join(", ")}).`,
      );
      return 1;
    }
    query.status = parsed.runStatus;
  }
  if (parsed.runTarget !== undefined) query.target = parsed.runTarget;
  if (parsed.since !== undefined) query.since = parsed.since;
  if (parsed.runLimit !== undefined) {
    const limit = parsePositiveInt(parsed.runLimit);
    if (limit === undefined) {
      cliReporter.error(
        `runs: --limit must be a positive integer (got "${parsed.runLimit}").`,
      );
      return 1;
    }
    query.limit = limit;
  }

  let keepMs: number | undefined;
  if (parsed.keep !== undefined) {
    try {
      keepMs = parseDuration(parsed.keep);
    } catch (error) {
      cliReporter.error(`runs: --keep is ${messageOf(error)}`);
      return 1;
    }
  }
  let keepLast: number | undefined;
  if (parsed.keepLast !== undefined) {
    keepLast = parsePositiveInt(parsed.keepLast);
    if (keepLast === undefined) {
      cliReporter.error(
        `runs: --keep-last must be a positive integer (got "${parsed.keepLast}").`,
      );
      return 1;
    }
  }

  return await runsCommand(build, {
    action: parsed.runsAction,
    runId: parsed.runsRunId,
    json: parsed.json,
    counts: parsed.runCounts,
    query,
    ...(parsed.initiator === undefined ? {} : { initiator: parsed.initiator }),
    keepMs,
    keepLast,
    dryRun: parsed.dryRun,
  });
}

/**
 * Run one CLI invocation, reporting a misconfigured backend URL as the
 * configuration mistake it is. A plaintext `ZUKE_*_URL` is refused wherever it
 * is resolved — a build run, `runs`, `resume`, `register` — so the report is
 * here, around every command, rather than at each resolution site.
 */
export async function main(
  BuildClass: new () => Build,
  args: string[],
  options: MainOptions = {},
): Promise<number> {
  try {
    return await runCommand(BuildClass, args, options);
  } catch (error) {
    if (error instanceof InsecureBackendUrlError) {
      cliReporter.error(error.message);
      return 1;
    }
    throw error;
  }
}

/** The body of {@link main}: parse the arguments and dispatch to the command. */
async function runCommand(
  BuildClass: new () => Build,
  args: string[],
  options: MainOptions = {},
): Promise<number> {
  const graphHost = options.graphHost ?? defaultGraphHost;
  const build = new BuildClass();
  const targets = discoverTargets(build);
  let params: Map<string, AnyParameter>;
  try {
    params = discoverParameters(build);
  } catch (error) {
    // A parameter whose name is refused (a reserved MCP control key, or a
    // name that renders as a built-in flag) is an authoring mistake, so it
    // reads as a named message and exit 1 — the same treatment as an invalid
    // graph — rather than as an uncaught throw with a stack trace. It has to
    // come before `--help`, because the help text lists the parameters that
    // discovery is what produces.
    if (error instanceof ParameterError) {
      cliReporter.error(error.message);
      return 1;
    }
    throw error;
  }
  discoverGroups(build); // names group batches so the graph can label them
  const paramFlags: ParamFlag[] = [...params.entries()].map(([name, p]) => ({
    name,
    flag: flagOf(name, p),
    boolean: p.kind_ === "boolean",
    array: p.array_,
  }));
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args, paramFlags);
  } catch (error) {
    // parseArgs only ever throws Error; messageOf narrows `unknown` without a
    // second branch here that no input can reach.
    cliReporter.error(messageOf(error));
    return 1;
  }

  if (parsed.help) {
    // `zuke mcp --help` asks about mcp, not about the build. The parser has
    // already recorded which command was named, so the detail the main help
    // leaves out is one lookup away.
    const command = namedCommand(parsed);
    const detail = command === undefined
      ? undefined
      : formatCommandHelp(command);
    cliReporter.info(detail ?? formatHelp(targets, params));
    return 0;
  }

  if (parsed.version) {
    // Bare, so a script can read it without parsing around a banner. Help
    // wins when both are given, matching how `--help` beats an unknown flag:
    // whoever asked for help is the one who needs it.
    cliReporter.info(VERSION);
    return 0;
  }

  try {
    validateGraph(targets);
  } catch (error) {
    if (error instanceof GraphError) {
      cliReporter.error(error.message);
      return 1;
    }
    throw error;
  }

  // `--json` prints the build surface, except when a command consumes it
  // itself (`runs list/show --json` emits run data; `register --json` emits the
  // written descriptor).
  if (parsed.json && !parsed.runs && !parsed.register) {
    const surface = describeBuildSurface(targets, params);
    printJson(surface);
    return 0;
  }
  if (parsed.list) {
    cliReporter.info(formatList(targets, params));
    return 0;
  }
  if (parsed.graph) {
    if (parsed.output === "html") {
      return await graphCommand(targets, { open: parsed.open }, graphHost);
    }
    cliReporter.info(formatGraph(targets));
    return 0;
  }
  if (parsed.completions) {
    const action = parsed.completionsAction;
    const shell = parsed.shell;
    const validAction = action === INSTALL_SUBCOMMAND ||
      action === PRINT_SUBCOMMAND;
    if (!validAction || shell === undefined || !isCompletionShell(shell)) {
      const shells = COMPLETION_SHELLS.join("|");
      cliReporter.error(`Usage: zuke completions <install|print> <${shells}>`);
      return 1;
    }
    if (action === INSTALL_SUBCOMMAND) {
      return await installCompletionScript(shell, targets, params, options);
    }
    cliReporter.info(formatCompletions(shell, targets, params));
    return 0;
  }
  if (parsed.generateCi) {
    return await syncCiConfig(build, { check: parsed.check });
  }
  if (parsed.mcp) {
    return await runMcp(build, parsed);
  }
  if (parsed.resume) {
    return await runResume(build, parsed, options.plugins);
  }
  if (parsed.runs) {
    return await runRuns(build, parsed);
  }
  if (parsed.cancel) {
    return await runCancel(build, parsed);
  }
  if (parsed.force) {
    return await runForce(build, parsed);
  }
  if (parsed.register) {
    return await runRegister(build, parsed);
  }
  if (parsed.doc) {
    return await runDoc(parsed, options.docRunner);
  }
  if (parsed.outdated) {
    return await runOutdated(parsed, options.outdatedOptions);
  }

  let name = parsed.target;
  if (name === undefined) {
    if (targets.has(DEFAULT_TARGET)) {
      name = DEFAULT_TARGET;
    } else {
      cliReporter.info(formatList(targets, params));
      return 0;
    }
  }

  const root = targets.get(name);
  if (!root) {
    // Same courtesy an unknown flag gets: a typo one edit away is named, and the
    // Map's declaration order keeps the suggestion deterministic.
    const suggestion = nearestName(name, [...targets.keys()]);
    const hint = suggestion === undefined
      ? ""
      : ` Did you mean "${suggestion}"?`;
    cliReporter.error(`Unknown target: ${name}.${hint}\n`);
    cliReporter.error(formatList(targets, params));
    return 1;
  }

  // A typo in an explicit flag is an error, not a silent default. The
  // environment fallback stays lenient — an unrecognised ZUKE_ACTOR_KIND reads
  // as unstated — because that value can arrive from anywhere, while this one
  // was typed by someone who meant something by it.
  // `find` both validates and narrows, so the value handed to `execute` is the
  // union rather than a string the type system has to be told about.
  const actorKind = ACTOR_KINDS.find((kind) => kind === parsed.actorKind);
  if (parsed.actorKind !== undefined && actorKind === undefined) {
    cliReporter.error(
      `--actor-kind must be one of: ${ACTOR_KINDS.join(", ")} ` +
        `(got "${parsed.actorKind}").`,
    );
    return 1;
  }

  // Keep declared CI config in sync as part of running the build: write
  // changes locally, but only verify on CI so an ephemeral checkout is never
  // dirtied — a drifted file fails the build there instead.
  if (!parsed.dryRun) {
    const ciCode = await syncCiConfig(build, {
      check: isCI(),
      quietWhenEmpty: true,
    });
    if (ciCode !== 0) return ciCode;
  }

  // A running build cancels gracefully on Ctrl-C/SIGTERM — running its
  // compensations — when `run` asks for it (`watchSignals`); a second signal
  // force-exits. Handlers are installed only here, around the build, so a signal
  // keeps its default terminate behaviour for `mcp` and every other command.
  // A test can inject `options.signal` directly instead.
  const controller = new AbortController();
  const cleanupSignals = options.watchSignals
    ? installCancelSignals(controller)
    : undefined;
  try {
    const result = await execute(build, root, {
      skip: parsed.skip,
      params: parsed.values,
      parallel: parsed.parallel,
      cache: parsed.cache,
      banner: parsed.banner,
      remoteCache: parsed.remoteCache === false ? false : undefined,
      affected: parsed.affected ? { base: parsed.affectedBase } : undefined,
      dryRun: parsed.dryRun,
      state: parsed.state,
      actor: parsed.actor,
      actorKind,
      plugins: options.plugins,
      renderer: options.renderer,
      ...(options.reporter === undefined ? {} : { reporter: options.reporter }),
      signal: cleanupSignals ? controller.signal : options.signal,
    });
    return result.ok ? 0 : 1;
  } finally {
    cleanupSignals?.();
  }
}

/**
 * Install SIGINT/SIGTERM handlers that abort `controller` on the first signal
 * (graceful cancel) and force-exit on a second, so a stuck build never traps the
 * operator. Returns a cleanup function that removes them. SIGTERM is skipped on
 * Windows (unsupported there).
 */
function installCancelSignals(controller: AbortController): () => void {
  let cancelling = false;
  const onSignal = () => {
    if (cancelling) Deno.exit(130);
    cancelling = true;
    controller.abort();
  };
  const wanted: Deno.Signal[] = Deno.build.os === "windows"
    ? ["SIGINT"]
    : ["SIGINT", "SIGTERM"];
  const installed: Deno.Signal[] = [];
  for (const sig of wanted) {
    try {
      Deno.addSignalListener(sig, onSignal);
      installed.push(sig);
    } catch {
      // A platform that doesn't support this signal — skip it.
    }
  }
  return () => {
    for (const sig of installed) {
      try {
        Deno.removeSignalListener(sig, onSignal);
      } catch {
        // Best-effort teardown.
      }
    }
  };
}

/** Options for {@link run}. */
export interface RunOptions {
  /** Command-line arguments. Defaults to `Deno.args`. */
  args?: string[];
  /** Lifecycle observers to run alongside the build's own hooks. */
  plugins?: Plugin[];
  /**
   * Renderer for the per-target banners and end-of-build summary. Defaults to
   * Zuke's built-in look; inject `consoleRenderer` from `@zuke/console` (or a
   * custom {@link Renderer}) to restyle a build's output.
   */
  renderer?: Renderer;
}

/**
 * Public entry point. Instantiate the build, parse arguments, run, and set the
 * process exit code.
 *
 * Call it at the bottom of your build file — no `import.meta.main` guard
 * needed. `run` acts only when its module is the program's entry point; when
 * the file is imported instead (for example under test) it does nothing.
 *
 * ```ts
 * await run(MyBuild);
 * // …with plugins:
 * await run(MyBuild, { plugins: [timing] });
 * ```
 */
export async function run(
  BuildClass: new () => Build,
  options: RunOptions = {},
): Promise<void> {
  // Run only when this build's module is the one Deno was started with, so the
  // caller needn't write `if (import.meta.main)`. Imported elsewhere, no-op.
  if (!isEntryModule(new Error().stack ?? "", import.meta.url)) return;
  // `watchSignals` lets `main` wire Ctrl-C/SIGTERM to graceful cancellation, but
  // only around a build run — every other command keeps default signal handling.
  const code = await main(BuildClass, options.args ?? Deno.args, {
    plugins: options.plugins,
    renderer: options.renderer,
    watchSignals: true,
  });
  Deno.exit(code);
}
