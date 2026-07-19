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

/** The `resume` command: continue a suspended run (external-event waits). */
export const RESUME_COMMAND = "resume";

/** The `runs` command: list and show persisted run records. */
export const RUNS_COMMAND = "runs";

/** The `cancel` command: cancel a run and run its compensations. */
export const CANCEL_COMMAND = "cancel";

/** The `register` command: record this build in the build registry. */
export const REGISTER_COMMAND = "register";

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
  {
    name: RESUME_COMMAND,
    description: "Resume a suspended run (or --check all suspended runs)",
  },
  {
    name: RUNS_COMMAND,
    description: "List or show persisted run records",
  },
  {
    name: CANCEL_COMMAND,
    description: "Cancel a run and run its compensations",
  },
  {
    name: REGISTER_COMMAND,
    description: "Register this build in the build registry",
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
    description:
      "With generate-ci verify files; with resume re-check suspended runs",
  },
  {
    name: "--signal",
    description: "With resume, deliver a named external signal",
  },
  {
    name: "--data",
    description: "With resume --signal, the signal's JSON payload",
  },
  {
    name: "--force-graph",
    description: "With resume, continue even if the build graph changed",
  },
  {
    name: "--status",
    description: "With runs list, keep only runs with this status",
  },
  {
    name: "--target",
    description: "With runs list, keep only runs whose graph has this target",
  },
  {
    name: "--since",
    description: "With runs list, keep only runs created at/after this time",
  },
  {
    name: "--allow-run",
    description:
      "With mcp, let agents run targets (optional =<glob-list> allow-list)",
  },
  {
    name: "--protect",
    description: "With mcp, require an operator token to run these targets",
  },
  {
    name: "--confirm-destructive",
    description: "With mcp, require confirm:true before a destructive run",
  },
  {
    name: "--registry",
    description:
      "With mcp, serve the build registry (dynamic pipeline discovery)",
  },
  {
    name: "--max-concurrent-runs",
    description:
      "With mcp --registry, cap concurrent run-tool spawns (default 4)",
  },
  {
    name: "--http",
    description: "With mcp, serve over HTTP on <host:port> instead of stdio",
  },
  { name: "--help", description: "Show usage" },
];
