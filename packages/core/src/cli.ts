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
import type { TargetBuilder } from "./target.ts";
import type { Plugin } from "./plugin.ts";
import {
  COMPLETION_SHELLS,
  type CompletionShell,
  formatCompletions,
  isCompletionShell,
} from "./completions.ts";
import {
  COMPLETIONS_COMMAND,
  DEFAULT_TARGET,
  GENERATE_CI_COMMAND,
  GRAPH_COMMAND,
} from "./cli_spec.ts";
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
    check: false,
    output: "text",
    open: true,
    values: {},
    affected: false,
    dryRun: false,
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
    } else if (arg === "--check") {
      parsed.check = true;
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
    } else if (
      parsed.target === undefined && !parsed.graph && !parsed.generateCi &&
      !parsed.completions
    ) {
      if (arg === GRAPH_COMMAND) parsed.graph = true;
      else if (arg === GENERATE_CI_COMMAND) parsed.generateCi = true;
      else if (arg === COMPLETIONS_COMMAND) parsed.completions = true;
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
    const suffix = deps.length ? `  (depends on: ${deps.join(", ")})` : "";
    lines.push(`  ${name.padEnd(width)}  ${desc}${suffix}`);
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
    const arrow = deps.length ? ` → ${deps.join(", ")}` : "";
    lines.push(`  ${name}${arrow}${group}`);
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

  if (parsed.json) {
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

  const result = await execute(build, root, {
    skip: parsed.skip,
    params: parsed.values,
    parallel: parsed.parallel,
    cache: parsed.cache,
    remoteCache: parsed.remoteCache === false ? false : undefined,
    affected: parsed.affected ? { base: parsed.affectedBase } : undefined,
    dryRun: parsed.dryRun,
    plugins: options.plugins,
    renderer: options.renderer,
  });
  return result.ok ? 0 : 1;
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
  const code = await main(BuildClass, options.args ?? Deno.args, {
    plugins: options.plugins,
    renderer: options.renderer,
  });
  Deno.exit(code);
}
