/**
 * The CLI surface: argument parsing, `--list`/`--help`/`graph`, and the public
 * {@link run} entry point that drives a build from `zuke.ts`.
 */

import { type Build, discoverGroups, discoverTargets } from "./build.ts";
import { discoverCiFiles, syncCiFiles } from "./ci.ts";
import { isEntryModule } from "./entry.ts";
import { isCI } from "./host.ts";
import { GraphError, validateGraph } from "./graph.ts";
import { execute } from "./executor.ts";
import type { Renderer } from "./renderer.ts";
import {
  defaultGraphHost,
  graphCommand,
  type GraphHost,
} from "./graph_view.ts";
import { type AnyParameter, discoverParameters, flagName } from "./params.ts";
import type { JsonValue, TargetBuilder } from "./target.ts";
import type { Plugin } from "./plugin.ts";
import {
  COMPLETION_SHELLS,
  type CompletionShell,
  formatCompletions,
  isCompletionShell,
} from "./completions.ts";
import {
  CANCEL_COMMAND,
  COMPLETIONS_COMMAND,
  DEFAULT_TARGET,
  GENERATE_CI_COMMAND,
  GRAPH_COMMAND,
  MCP_COMMAND,
  REGISTER_COMMAND,
  RESUME_COMMAND,
  RUNS_COMMAND,
} from "./cli_spec.ts";
import { type HttpAddress, serveMcp } from "./mcp/command.ts";
import { cancelRun } from "./cancel.ts";
import { resumeCheck, resumeRun } from "./resume.ts";
import { runsCommand } from "./runs.ts";
import { registerCommand } from "./registry/register.ts";
import { isRunStatus, RUN_STATUS_NAMES, type RunQuery } from "./state/types.ts";
import {
  installCompletions,
  type InstallOptions,
} from "./completions_install.ts";
import { describeBuildSurface } from "./describe.ts";

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
  /** Require `confirm:true` before a destructive `mcp` run (`--confirm-destructive`). */
  confirmDestructive: boolean;
  /** Serve `mcp` over the build registry (dynamic discovery) rather than one build (`--registry`). */
  mcpRegistry: boolean;
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
  /** The `cancel` command was requested (cancel a run and run its compensations). */
  cancel: boolean;
  /** The run id to cancel (the positional after `cancel`). */
  cancelRunId?: string;
  /** The `register` command was requested (record this build in the registry). */
  register: boolean;
  /** Raw parameter values from declared flags, keyed by property name. */
  values: Record<string, string>;
  help: boolean;
}

/** Parse a `--parallel`/`--parallel=N` value: a positive count, or `true`. */
function parseParallel(value: string | undefined): boolean | number {
  if (value === undefined || value === "") return true;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : true;
}

/**
 * Parse `zuke` arguments. Built-in flags are recognised first; `paramFlags`
 * lets the caller pass the build's declared parameter flags so their values are
 * collected. Unknown flags are ignored.
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
    runs: false,
    cancel: false,
    register: false,
    confirmDestructive: false,
    mcpRegistry: false,
    help: false,
  };
  const byFlag = new Map<string, ParamFlag>();
  for (const pf of paramFlags) byFlag.set(pf.flag, pf);

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
    } else if (arg === "--actor") {
      const who = args[++i];
      if (who) parsed.actor = who;
    } else if (arg.startsWith("--actor=")) {
      parsed.actor = arg.slice("--actor=".length);
    } else if (arg === "--signal") {
      const name = args[++i];
      if (name) parsed.signal = name;
    } else if (arg.startsWith("--signal=")) {
      parsed.signal = arg.slice("--signal=".length);
    } else if (arg === "--data") {
      const json = args[++i];
      if (json !== undefined) parsed.data = json;
    } else if (arg.startsWith("--data=")) {
      parsed.data = arg.slice("--data=".length);
    } else if (arg === "--force-graph") {
      parsed.forceGraph = true;
    } else if (arg === "--status") {
      const value = args[++i];
      if (value) parsed.runStatus = value;
    } else if (arg.startsWith("--status=")) {
      parsed.runStatus = arg.slice("--status=".length);
    } else if (arg === "--target") {
      const value = args[++i];
      if (value) parsed.runTarget = value;
    } else if (arg.startsWith("--target=")) {
      parsed.runTarget = arg.slice("--target=".length);
    } else if (arg === "--since") {
      const value = args[++i];
      if (value) parsed.since = value;
    } else if (arg.startsWith("--since=")) {
      parsed.since = arg.slice("--since=".length);
    } else if (arg === "--check") {
      parsed.check = true;
    } else if (arg === "--allow-run") {
      parsed.allowRun = true;
    } else if (arg.startsWith("--allow-run=")) {
      parsed.allowRun = true;
      parsed.allowRunPatterns = splitList(arg.slice("--allow-run=".length));
    } else if (arg === "--protect") {
      const value = args[++i];
      if (value) parsed.protectPatterns = splitList(value);
    } else if (arg.startsWith("--protect=")) {
      parsed.protectPatterns = splitList(arg.slice("--protect=".length));
    } else if (arg === "--confirm-destructive") {
      parsed.confirmDestructive = true;
    } else if (arg === "--registry") {
      parsed.mcpRegistry = true;
    } else if (arg === "--http") {
      const value = args[++i];
      if (value) parsed.httpAddr = value;
    } else if (arg.startsWith("--http=")) {
      parsed.httpAddr = arg.slice("--http=".length);
    } else if (arg === "--parallel") {
      parsed.parallel = true;
    } else if (arg.startsWith("--parallel=")) {
      parsed.parallel = parseParallel(arg.slice("--parallel=".length));
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--skip") {
      const dep = args[++i];
      if (dep) parsed.skip.push(dep);
    } else if (arg === "--output") {
      const value = args[++i];
      if (value) parsed.output = parseOutput(value);
    } else if (arg.startsWith("--output=")) {
      parsed.output = parseOutput(arg.slice("--output=".length));
    } else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const flag = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const pf = byFlag.get(flag);
      if (pf !== undefined) {
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
      }
      // Unknown flags are ignored.
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
    } else if (
      parsed.target === undefined && !parsed.graph && !parsed.generateCi &&
      !parsed.completions && !parsed.mcp && !parsed.resume && !parsed.runs &&
      !parsed.cancel && !parsed.register
    ) {
      if (arg === GRAPH_COMMAND) parsed.graph = true;
      else if (arg === GENERATE_CI_COMMAND) parsed.generateCi = true;
      else if (arg === COMPLETIONS_COMMAND) parsed.completions = true;
      else if (arg === MCP_COMMAND) parsed.mcp = true;
      else if (arg === RESUME_COMMAND) parsed.resume = true;
      else if (arg === RUNS_COMMAND) parsed.runs = true;
      else if (arg === CANCEL_COMMAND) parsed.cancel = true;
      else if (arg === REGISTER_COMMAND) parsed.register = true;
      else parsed.target = arg;
    }
  }
  return parsed;
}

/** Names of a target's direct dependencies, in declaration order. */
function depNames(t: TargetBuilder): string[] {
  return t.dependsOn_.map((d) => d.name_ ?? "?");
}

const USAGE = `zuke — code-first build automation

Usage:
  deno run -A zuke.ts <target> [--skip <dep>] [--parallel[=N]] [--affected[=<base>]]
  deno run -A zuke.ts --list [--json]
  deno run -A zuke.ts graph [--output=html] [--no-open]
  deno run -A zuke.ts generate-ci [--check]
  deno run -A zuke.ts completions <install|print> <bash|zsh|fish>
  deno run -A zuke.ts mcp [--allow-run] [--registry] [--http <host:port>]
  deno run -A zuke.ts resume <run-id> [--signal <name>] [--data <json>]
  deno run -A zuke.ts resume --check [<run-id>]
  deno run -A zuke.ts runs list [--status <s>] [--target <t>] [--since <iso>] [--json]
  deno run -A zuke.ts runs show <run-id> [--json]
  deno run -A zuke.ts cancel <run-id> [--actor <name>]
  deno run -A zuke.ts register [--actor <name>] [--json]

Options:
  <target>          Run the target and its transitive dependencies.
  --skip <dep>      Skip the named dependency (repeatable).
  --parallel[=N]    Run independent targets concurrently (N = max in flight,
                    default = CPU count).
  --no-cache        Ignore the incremental cache; re-run every target.
  --no-remote-cache Use the local cache only; do not restore from or upload to
                    the configured remote cache store.
  --affected[=<base>]
                    Run only targets affected by files changed since <base>
                    (a git revision; default HEAD). A target is affected when a
                    changed file is under its declared inputs or a dependency is
                    affected; targets with no declared inputs always run.
  --dry-run         Print the execution plan without running target bodies.
  --state           Persist durable run state under .zuke/runs (a run record
                    with per-target status and metadata), unless a store is
                    already configured via ZUKE_STATE_URL/ZUKE_STATE_DIR or the
                    build's stateStore(). See docs/state.md.
  --actor <name>    Attribute the run to <name> in its state record (else
                    ZUKE_ACTOR, the CI actor, or "anonymous").
  --list, -l        List all targets with descriptions and dependencies.
  --json            With --list, print the build surface (commands, flags,
                    targets, parameters) as JSON for tools and agents.
  graph             Show the dependency graph. Default output is the terminal
                    adjacency listing; --output=html writes an interactive
                    page to .zuke/ and opens it in a browser.
  generate-ci       Write the CI configuration files declared on the build
                    (via cicd()). Running any target regenerates them too.
  completions       Shell completion for bash, zsh, or fish, completing target
                    names, commands, and flags. 'print <shell>' writes the
                    script to stdout (source it, e.g.
                    source <(deno run -A zuke.ts completions print bash));
                    'install <shell>' writes it and wires it into your shell's
                    startup automatically.
  --check           With generate-ci, verify the files are current instead of
                    writing them, failing if any has drifted (use on CI).
  --output <fmt>    Graph output format: text (default) or html.
  --no-open         With --output=html, do not open a browser.
  mcp               Run an MCP server over the build on stdio, exposing its
                    targets to AI agents as typed tools. Read-only by default
                    (inspect the targets, parameters, and graph); add
                    --allow-run to let agents execute targets too.
  --allow-run[=<globs>]
                    With mcp, allow agents to execute targets (not just inspect
                    them). An optional =<comma,globs> allow-list exposes only the
                    matching targets as run tools; others are invisible.
  --protect <globs> With mcp, require an operator token (ZUKE_OPERATOR_TOKEN) as
                    a tool-call argument to run the matching targets.
  --confirm-destructive
                    With mcp, make a destructive run tool return its plan unless
                    called with confirm:true (a .readOnly() target is exempt).
  --registry        With mcp, serve the build registry instead of this one build:
                    expose every registered pipeline's targets as tools, re-read
                    live so a newly-registered build appears with no restart. A
                    run tool spawns the registered build's launch command (behind
                    --allow-run + the same authz). See docs/registry.md.
  --http <host:port>
                    With mcp, serve the streamable-HTTP transport on the given
                    address instead of stdio. Just <port> binds 127.0.0.1. A
                    non-loopback host requires a bearer token (ZUKE_MCP_TOKEN);
                    put real TLS/authn in front for production. See docs/mcp.md.
  resume            Continue a suspended run (a .waitsFor() gate). Exactly one
                    resumer wins; the rest report "already resumed". With
                    --check [<run-id>] it re-checks suspended runs (predicate
                    waits, timeouts) — the cron/webhook entry point.
  --signal <name>   With resume, deliver a named external signal to the run.
  --data <json>     With resume --signal, the signal's JSON payload (default {}).
  --force-graph     With resume, continue even if the build graph changed since
                    the run was suspended.
  runs              Inspect persisted run records from the state store. 'list'
                    prints one row per run (newest first); 'show <run-id>'
                    reconstructs a run's full per-target status and metadata.
                    Both accept --json for tools. See docs/state.md.
  cancel            Cancel a run <run-id>: stop it (a live run aborts), run the
                    compensations of every target that had succeeded — in
                    reverse order — and mark the record cancelled. Idempotent:
                    cancelling a finished run is a no-op. See docs/orchestration.md.
  register          Record this build in the build registry (its targets,
                    parameters, and launch location) so a registry-backed MCP
                    server can discover it. Idempotent; excludes secrets. Writes
                    to .zuke/builds unless ZUKE_REGISTRY_URL/DIR or the build's
                    registry() configures a store. See docs/registry.md.
  --status <s>      With runs list, keep only runs with this status (running,
                    suspended, succeeded, failed, cancelled).
  --target <t>      With runs list, keep only runs whose graph contains this
                    target.
  --since <iso>     With runs list, keep only runs created at or after this
                    ISO-8601 timestamp.
  --<param> <val>   Set a declared build parameter (see Parameters below).
  --help, -h        Show this help.`;

/** Render `--help`, including the available targets and parameters. */
export function formatHelp(
  targets: Map<string, TargetBuilder>,
  params: Map<string, AnyParameter> = new Map(),
): string {
  return `${USAGE}\n\n${formatList(targets, params)}`;
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
  const flags = [...params.keys()].map(flagName);
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
    lines.push(`  --${flagName(name).padEnd(width)}  ${desc}${meta}`);
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
      console.log("No CI configuration is declared on this build.");
    }
    return 0;
  }
  const results = await syncCiFiles(files, { check: options.check });
  const stale: string[] = [];
  for (const { path, status } of results) {
    if (status === "written") console.log(`Generated ${path}`);
    else if (status === "stale") stale.push(path);
  }
  if (stale.length > 0) {
    console.error(
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
  /** Lifecycle observers to run alongside the build's own hooks. */
  plugins?: Plugin[];
  /** Overrides for `completions install` (home/config dir), injected in tests. */
  installOptions?: InstallOptions;
  /** Renderer for the build's banners and summary (see {@link RunOptions}). */
  renderer?: Renderer;
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
    console.log(`Installed ${result.shell} completion to ${result.scriptPath}`);
    if (result.rcPath === undefined) {
      console.log("Open a new shell (or restart fish) to load it.");
    } else if (result.alreadySourced) {
      console.log(`${result.rcPath} already sources it — nothing to change.`);
    } else {
      console.log(
        `Added a source line to ${result.rcPath}; open a new shell to use it.`,
      );
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
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
  if (raw.length > MAX_SIGNAL_DATA_BYTES) {
    throw new Error(
      `resume: --data payload is too large (${raw.length} bytes; ` +
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
        plugins,
      });
      console.log(`Checked ${checked} suspended run(s); ${failed} failed.`);
      return failed > 0 ? 1 : 0;
    }
    if (parsed.resumeRunId === undefined) {
      console.error(
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
      plugins,
    });
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
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
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  return await serveMcp(build, {
    allowRun: parsed.allowRun,
    allowRunPatterns: parsed.allowRunPatterns,
    protectPatterns: parsed.protectPatterns,
    confirmDestructive: parsed.confirmDestructive,
    useRegistry: parsed.mcpRegistry,
    actor: parsed.actor,
    http,
  });
}

/** Run the `cancel` command: cancel a run and run its compensations. */
async function runCancel(build: Build, parsed: ParsedArgs): Promise<number> {
  if (parsed.cancelRunId === undefined) {
    console.error("Usage: zuke cancel <run-id> [--actor <name>]");
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
    console.error(error instanceof Error ? error.message : String(error));
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
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** Run the `runs` command: build the query (validating `--status`) and dispatch. */
async function runRuns(build: Build, parsed: ParsedArgs): Promise<number> {
  const query: RunQuery = {};
  if (parsed.runStatus !== undefined) {
    if (!isRunStatus(parsed.runStatus)) {
      console.error(
        `runs: unknown --status "${parsed.runStatus}" ` +
          `(one of: ${RUN_STATUS_NAMES.join(", ")}).`,
      );
      return 1;
    }
    query.status = parsed.runStatus;
  }
  if (parsed.runTarget !== undefined) query.target = parsed.runTarget;
  if (parsed.since !== undefined) query.since = parsed.since;
  return await runsCommand(build, {
    action: parsed.runsAction,
    runId: parsed.runsRunId,
    json: parsed.json,
    query,
  });
}

export async function main(
  BuildClass: new () => Build,
  args: string[],
  options: MainOptions = {},
): Promise<number> {
  const graphHost = options.graphHost ?? defaultGraphHost;
  const build = new BuildClass();
  const targets = discoverTargets(build);
  const params = discoverParameters(build);
  discoverGroups(build); // names group batches so the graph can label them
  const paramFlags: ParamFlag[] = [...params.entries()].map(([name, p]) => ({
    name,
    flag: flagName(name),
    boolean: p.kind_ === "boolean",
    array: p.array_,
  }));
  const parsed = parseArgs(args, paramFlags);

  if (parsed.help) {
    console.log(formatHelp(targets, params));
    return 0;
  }

  try {
    validateGraph(targets);
  } catch (error) {
    if (error instanceof GraphError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  // `--json` prints the build surface, except when a command consumes it
  // itself (`runs list/show --json` emits run data; `register --json` emits the
  // written descriptor).
  if (parsed.json && !parsed.runs && !parsed.register) {
    const surface = describeBuildSurface(targets, params);
    console.log(JSON.stringify(surface, null, 2));
    return 0;
  }
  if (parsed.list) {
    console.log(formatList(targets, params));
    return 0;
  }
  if (parsed.graph) {
    if (parsed.output === "html") {
      return await graphCommand(targets, { open: parsed.open }, graphHost);
    }
    console.log(formatGraph(targets));
    return 0;
  }
  if (parsed.completions) {
    const action = parsed.completionsAction;
    const shell = parsed.shell;
    const validAction = action === INSTALL_SUBCOMMAND ||
      action === PRINT_SUBCOMMAND;
    if (!validAction || shell === undefined || !isCompletionShell(shell)) {
      const shells = COMPLETION_SHELLS.join("|");
      console.error(`Usage: zuke completions <install|print> <${shells}>`);
      return 1;
    }
    if (action === INSTALL_SUBCOMMAND) {
      return await installCompletionScript(shell, targets, params, options);
    }
    console.log(formatCompletions(shell, targets, params));
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
  if (parsed.register) {
    return await runRegister(build, parsed);
  }

  let name = parsed.target;
  if (name === undefined) {
    if (targets.has(DEFAULT_TARGET)) {
      name = DEFAULT_TARGET;
    } else {
      console.log(formatList(targets, params));
      return 0;
    }
  }

  const root = targets.get(name);
  if (!root) {
    console.error(`Unknown target: ${name}\n`);
    console.error(formatList(targets, params));
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
      remoteCache: parsed.remoteCache === false ? false : undefined,
      affected: parsed.affected ? { base: parsed.affectedBase } : undefined,
      dryRun: parsed.dryRun,
      state: parsed.state,
      actor: parsed.actor,
      plugins: options.plugins,
      renderer: options.renderer,
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
