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

/** Every reserved command, in help and completion order. */
export const RESERVED_COMMANDS: readonly ReservedCommand[] = [
  { name: GRAPH_COMMAND, description: "Show the dependency graph" },
  {
    name: GENERATE_CI_COMMAND,
    description: "Write declared CI configuration files",
  },
  { name: COMPLETIONS_COMMAND, description: "Print a shell-completion script" },
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
  { name: "--skip", description: "Skip the named dependency" },
  { name: "--parallel", description: "Run independent targets concurrently" },
  { name: "--no-cache", description: "Ignore the incremental cache" },
  { name: "--dry-run", description: "Print the plan without running targets" },
  { name: "--output", description: "Graph output format: text or html" },
  {
    name: "--no-open",
    description: "With --output=html, do not open a browser",
  },
  {
    name: "--check",
    description: "With generate-ci, verify files are current",
  },
  { name: "--help", description: "Show usage" },
];
