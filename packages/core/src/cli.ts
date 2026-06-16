/**
 * The CLI surface: argument parsing, `--list`/`--help`/`--graph`, and the
 * public {@link run} entry point that drives a build from `zuke.ts`.
 */

import { type Build, discoverTargets } from "./build.ts";
import { GraphError, validateGraph } from "./graph.ts";
import { execute } from "./executor.ts";
import {
  defaultGraphHost,
  graphCommand,
  type GraphHost,
} from "./graph_view.ts";
import type { TargetBuilder } from "./target.ts";

/** Convention: a target literally named `default` runs when none is requested. */
const DEFAULT_TARGET = "default";

/** The reserved positional command that renders the interactive HTML graph. */
const GRAPH_COMMAND = "graph";

/** Parsed command-line arguments. */
export interface ParsedArgs {
  /** The requested target, if a positional argument was given. */
  target?: string;
  /** Dependencies to skip (`--skip <dep>`, repeatable). */
  skip: string[];
  list: boolean;
  graph: boolean;
  /** Render the interactive HTML graph (`graph` command). */
  graphHtml: boolean;
  /** Open the generated graph in a browser (default true; `--no-open` clears). */
  open: boolean;
  /** Output path for the generated graph (`--out <path>`). */
  out?: string;
  help: boolean;
}

/** Parse `zuke` arguments. Unknown flags are reported by the caller. */
export function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    skip: [],
    list: false,
    graph: false,
    graphHtml: false,
    open: true,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--list":
      case "-l":
        parsed.list = true;
        break;
      case "--graph":
        parsed.graph = true;
        break;
      case "--no-open":
        parsed.open = false;
        break;
      case "--out": {
        const out = args[++i];
        if (out) parsed.out = out;
        break;
      }
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--skip": {
        const dep = args[++i];
        if (dep) parsed.skip.push(dep);
        break;
      }
      default:
        if (
          !arg.startsWith("-") && parsed.target === undefined &&
          !parsed.graphHtml
        ) {
          if (arg === GRAPH_COMMAND) parsed.graphHtml = true;
          else parsed.target = arg;
        }
        break;
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
  deno run -A zuke.ts <target> [--skip <dep>]
  deno run -A zuke.ts --list
  deno run -A zuke.ts --graph
  deno run -A zuke.ts graph [--out <path>] [--no-open]

Options:
  <target>        Run the target and its transitive dependencies.
  --skip <dep>    Skip the named dependency (repeatable).
  --list, -l      List all targets with descriptions and dependencies.
  --graph         Print the dependency graph.
  graph           Render an interactive HTML graph into .zuke/ and open it.
  --out <path>    Output path for the HTML graph (with the graph command).
  --no-open       Do not open the generated graph in a browser.
  --help, -h      Show this help.`;

/** Render `--help`, including the available targets. */
export function formatHelp(targets: Map<string, TargetBuilder>): string {
  return `${USAGE}\n\n${formatList(targets)}`;
}

/** Render `--list`: each target with its description and dependencies. */
export function formatList(targets: Map<string, TargetBuilder>): string {
  if (targets.size === 0) return "No targets defined.";
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

/** Render `--graph`: an adjacency listing of `target → dependencies`. */
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
  const parsed = parseArgs(args);

  if (parsed.help) {
    console.log(formatHelp(targets));
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
    console.log(formatList(targets));
    return 0;
  }
  if (parsed.graph) {
    console.log(formatGraph(targets));
    return 0;
  }
  if (parsed.graphHtml) {
    return await graphCommand(
      targets,
      { open: parsed.open, out: parsed.out },
      graphHost,
    );
  }

  let name = parsed.target;
  if (name === undefined) {
    if (targets.has(DEFAULT_TARGET)) {
      name = DEFAULT_TARGET;
    } else {
      console.log(formatList(targets));
      return 0;
    }
  }

  const root = targets.get(name);
  if (!root) {
    console.error(`Unknown target: ${name}\n`);
    console.error(formatList(targets));
    return 1;
  }

  const result = await execute(build, root, { skip: parsed.skip });
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
