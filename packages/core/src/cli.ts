/**
 * The CLI surface: argument parsing, `--list`/`--help`/`graph`, and the public
 * {@link run} entry point that drives a build from `zuke.ts`.
 */

import { type Build, discoverTargets } from "./build.ts";
import { GraphError, validateGraph } from "./graph.ts";
import { execute } from "./executor.ts";
import {
  defaultGraphHost,
  graphCommand,
  type GraphHost,
} from "./graph_view.ts";
import { type AnyParameter, discoverParameters, flagName } from "./params.ts";
import type { TargetBuilder } from "./target.ts";

/** Convention: a target literally named `default` runs when none is requested. */
const DEFAULT_TARGET = "default";

/** The reserved positional command that renders the dependency graph. */
const GRAPH_COMMAND = "graph";

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
}

/** Parsed command-line arguments. */
export interface ParsedArgs {
  /** The requested target, if a positional argument was given. */
  target?: string;
  /** Dependencies to skip (`--skip <dep>`, repeatable). */
  skip: string[];
  list: boolean;
  /** The `graph` command was requested. */
  graph: boolean;
  /** Graph output format (`--output`); defaults to `text`. */
  output: GraphOutput;
  /** Open the HTML graph in a browser (default true; `--no-open` clears). */
  open: boolean;
  /** Run independent targets concurrently (`--parallel[=N]`). */
  parallel?: boolean | number;
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
    graph: false,
    output: "text",
    open: true,
    values: {},
    help: false,
  };
  const byFlag = new Map<string, ParamFlag>();
  for (const pf of paramFlags) byFlag.set(pf.flag, pf);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--list" || arg === "-l") {
      parsed.list = true;
    } else if (arg === "--no-open") {
      parsed.open = false;
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
        if (eq !== -1) parsed.values[pf.name] = arg.slice(eq + 1);
        else if (pf.boolean) parsed.values[pf.name] = "true";
        else {
          const value = args[++i];
          if (value !== undefined) parsed.values[pf.name] = value;
        }
      }
      // Unknown flags are ignored.
    } else if (parsed.target === undefined && !parsed.graph) {
      if (arg === GRAPH_COMMAND) parsed.graph = true;
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
  deno run -A zuke.ts <target> [--skip <dep>] [--parallel[=N]]
  deno run -A zuke.ts --list
  deno run -A zuke.ts graph [--output=html] [--no-open]

Options:
  <target>          Run the target and its transitive dependencies.
  --skip <dep>      Skip the named dependency (repeatable).
  --parallel[=N]    Run independent targets concurrently (N = max in flight,
                    default = CPU count).
  --list, -l        List all targets with descriptions and dependencies.
  graph             Show the dependency graph. Default output is the terminal
                    adjacency listing; --output=html writes an interactive
                    page to .zuke/ and opens it in a browser.
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
  const targetText = targets.size === 0
    ? "No targets defined."
    : renderTargets(targets);
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
    lines.push(deps.length ? `  ${name} → ${deps.join(", ")}` : `  ${name}`);
  }
  return lines.join("\n");
}

/**
 * Drive a build to completion and resolve to a process exit code (0 success,
 * 1 failure). Does not call `Deno.exit`, so it is unit-testable; {@link run}
 * wraps it. Output goes through `console` unless `execute` options say otherwise.
 */
export async function main(
  BuildClass: new () => Build,
  args: string[],
  graphHost: GraphHost = defaultGraphHost,
): Promise<number> {
  const build = new BuildClass();
  const targets = discoverTargets(build);
  const params = discoverParameters(build);
  const paramFlags: ParamFlag[] = [...params.entries()].map(([name, p]) => ({
    name,
    flag: flagName(name),
    boolean: p.kind_ === "boolean",
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

  const result = await execute(build, root, {
    skip: parsed.skip,
    params: parsed.values,
    parallel: parsed.parallel,
  });
  return result.ok ? 0 : 1;
}

/**
 * Public entry point. Instantiate the build, parse `Deno.args`, run, and set the
 * process exit code.
 *
 * ```ts
 * if (import.meta.main) { await run(MyBuild); }
 * ```
 */
export async function run(
  BuildClass: new () => Build,
  args: string[] = Deno.args,
): Promise<void> {
  const code = await main(BuildClass, args);
  Deno.exit(code);
}
