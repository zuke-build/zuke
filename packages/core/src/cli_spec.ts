/**
 * The static CLI surface — the reserved positional commands and the built-in
 * option flags — as a single source of truth shared by the argument parser
 * (`cli.ts`), the help text, and the shell-completion generator
 * (`completions.ts`). Adding a command or flag here makes it appear in
 * completions automatically; `cli_test.ts` guards that the parser and the help
 * stay in step with these lists, so a new entry can't be silently forgotten.
 *
 * @module
 */

/** Convention: a target literally named `default` runs when none is requested. */
export const DEFAULT_TARGET = "default";

/** A reserved positional command: a CLI word that is not a target name. */
export interface ReservedCommand {
  /** The literal command word typed on the command line. */
  readonly name: string;
  /** One-line summary, surfaced in help and completion. */
  readonly description: string;
}

/** The `graph` command: render the dependency graph. */
export const GRAPH_COMMAND = "graph";

/** The `generate-ci` command: write declared CI configuration files. */
export const GENERATE_CI_COMMAND = "generate-ci";

/** The `completions` command: print a shell-completion script. */
export const COMPLETIONS_COMMAND = "completions";

/** The `mcp` command: run an MCP server over the build (for AI agents). */
export const MCP_COMMAND = "mcp";

/** Every reserved command, in help and completion order. */
export const RESERVED_COMMANDS: readonly ReservedCommand[] = [
  { name: GRAPH_COMMAND, description: "Show the dependency graph" },
  {
    name: GENERATE_CI_COMMAND,
    description: "Write declared CI configuration files",
  },
  { name: COMPLETIONS_COMMAND, description: "Print a shell-completion script" },
  {
    name: MCP_COMMAND,
    description: "Run an MCP server over the build (for AI agents)",
  },
];

/** A built-in option flag (its long form), surfaced in help and completion. */
export interface BuiltinFlag {
  /** The flag, with its leading dashes (e.g. `--list`). */
  readonly name: string;
  /** One-line summary. */
  readonly description: string;
}

/** Every built-in option flag, in completion order. */
export const BUILTIN_FLAGS: readonly BuiltinFlag[] = [
  { name: "--list", description: "List all targets with descriptions" },
  {
    name: "--json",
    description: "Print the build surface (commands, flags, targets) as JSON",
  },
  { name: "--skip", description: "Skip the named dependency" },
  { name: "--parallel", description: "Run independent targets concurrently" },
  { name: "--no-cache", description: "Ignore the incremental cache" },
  {
    name: "--no-remote-cache",
    description: "Use the local cache only; skip the remote cache store",
  },
  {
    name: "--affected",
    description: "Run only targets affected by changes since a git base",
  },
  { name: "--dry-run", description: "Print the plan without running targets" },
  {
    name: "--state",
    description: "Persist durable run state to .zuke/runs",
  },
  {
    name: "--actor",
    description: "Attribute the run to <name> in its state record",
  },
  { name: "--output", description: "Graph output format: text or html" },
  {
    name: "--no-open",
    description: "With --output=html, do not open a browser",
  },
  {
    name: "--check",
    description: "With generate-ci, verify files are current",
  },
  {
    name: "--allow-run",
    description: "With mcp, let agents execute targets (not just inspect)",
  },
  { name: "--help", description: "Show usage" },
];
