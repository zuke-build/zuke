// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
  /**
   * Usage lines for the command, without the program name, e.g.
   * `["graph [--output=html] [--no-open]"]`. Shown in the command's own help.
   */
  readonly usage?: readonly string[];
  /**
   * The full explanation, shown by `<command> --help` and nowhere else.
   *
   * Kept here beside the one-liner rather than in the help template, so the
   * two cannot drift and the short form stays the only thing the main help
   * has to print.
   */
  readonly detail?: string;
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

/** The `force` command: settle a target of a live run without running it. */
export const FORCE_COMMAND = "force";

/** The `register` command: record this build in the build registry. */
export const REGISTER_COMMAND = "register";

/** The `doc` command: print a package's API docs, isolated from the repo. */
export const DOC_COMMAND = "doc";

/** The `outdated` command: report JSR packages the lock resolves behind. */
export const OUTDATED_COMMAND = "outdated";

/** Every reserved command, in help and completion order. */
export const RESERVED_COMMANDS: readonly ReservedCommand[] = [
  {
    name: GRAPH_COMMAND,
    description: "Show the dependency graph",
    usage: ["graph [--output=html] [--no-open]"],
    detail:
      "The default output is the terminal adjacency listing. --output=html writes an interactive page to .zuke/ and opens it in a browser.",
  },
  {
    name: GENERATE_CI_COMMAND,
    description: "Write declared CI configuration files",
    usage: ["generate-ci [--check]"],
    detail:
      "The files are the ones the build declares through cicd(). Running any target regenerates them too, so this command is for writing them on their own; --check verifies they are current instead.",
  },
  {
    name: COMPLETIONS_COMMAND,
    description: "Print a shell-completion script",
    usage: ["completions <install|print> <bash|zsh|fish>"],
    detail:
      "Completes target names, commands and flags, for bash, zsh or fish.\n\n'print <shell>' writes the script to stdout for you to source, e.g. source <(./zuke completions print bash). 'install <shell>' writes it and wires it into your shell's startup automatically.",
  },
  {
    name: MCP_COMMAND,
    description: "Run an MCP server over the build (for AI agents)",
    usage: [
      "mcp [--allow-run[=<globs>]] [--protect <globs>] [--confirm-destructive]",
      "mcp --http <host:port> [--allowed-origin <origin>]",
      "mcp --registry [--max-concurrent-runs <n>]",
    ],
    detail:
      "Serves on stdio, exposing the build's targets as typed tools.\n\nRead-only by default: an agent may inspect the targets, parameters and graph, but not execute anything. The options below open that up in tiers, and they have deliberately different reach — --allow-run decides which targets may be invoked, and invoking one runs its dependencies, so allow-listing a target allows everything it does. See docs/mcp.md.",
  },
  {
    name: RESUME_COMMAND,
    description: "Resume a suspended run (or --check all suspended runs)",
    usage: [
      "resume <run-id> [--signal <name>] [--data <json>]",
      "resume --check [<run-id>]",
    ],
    detail:
      "A suspended run is one stopped at a .waitsFor() gate.\n\nExactly one resumer wins; the rest report that it was already resumed, so it is safe to wire to a webhook that may deliver twice. --check re-checks suspended runs instead, evaluating predicate waits and timeouts, which is the entry point for a cron schedule.",
  },
  {
    name: RUNS_COMMAND,
    description: "List, show, or prune persisted run records",
    usage: [
      "runs list [--status <s>] [--target <t>] [--since <iso>] " +
      "[--initiator <n>] [--limit <n>] [--counts] [--json]",
      "runs show <run-id> [--json]",
      "runs prune [--keep <age>] [--keep-last <n>] [--dry-run]",
    ],
    detail:
      "Reads the records the state store persisted.\n\n'list' prints one row per run, newest first. 'show <run-id>' reconstructs a run's full per-target status and metadata. 'prune' deletes old terminal records. All accept --json for tools. See docs/state.md.",
  },
  {
    name: CANCEL_COMMAND,
    description: "Cancel a run and run its compensations",
    usage: ["cancel <run-id> [--actor <name>]"],
    detail:
      "A live run aborts; then the compensations of every target that had succeeded run in reverse order, and the record is marked cancelled.\n\nIdempotent: cancelling a finished run is a no-op. See docs/orchestration.md.",
  },
  {
    name: FORCE_COMMAND,
    description: "Force a target of a run to skipped or succeeded",
    usage: [
      "force <run-id> <target> --outcome skipped|succeeded [--reason <why>]",
    ],
    detail:
      "Settles the target without running it, so a stuck run can move on.\n\n--outcome skipped takes the step off the plan; --outcome succeeded records that someone did it by hand, and a later cancel compensates it.",
  },
  {
    name: REGISTER_COMMAND,
    description: "Register this build in the build registry",
    usage: ["register [--actor <name>] [--json]"],
    detail:
      "Records the build's targets, parameters and launch location, so a registry-backed MCP server can discover it.\n\nIdempotent, and excludes secrets. Writes to .zuke/builds unless ZUKE_REGISTRY_URL, ZUKE_REGISTRY_DIR or the build's registry() configures a store. See docs/registry.md.",
  },
  {
    name: DOC_COMMAND,
    description:
      "Print a package's API docs (deno doc), isolated from the repo",
    usage: ["doc <spec>"],
    detail:
      "Runs 'deno doc <spec>' from an isolated empty directory, e.g. doc jsr:@zuke/deno.\n\nThe empty directory is the point. Run in a Node repo, deno doc otherwise resolves node_modules/@types and buries the API under type-resolution warnings; an empty cwd has nothing to resolve. A relative path such as ./mod.ts is resolved against the real working directory first.",
  },
  {
    name: OUTDATED_COMMAND,
    description: "Report JSR packages the lock resolves behind their latest",
    usage: ["outdated [--update [<package>...]] [--exit-code]"],
    detail:
      "Compares what the lock resolves against each package's latest release, and with --update moves them up.\n\nIt needs the network, which is why it is a command rather than a line in --list: those stay offline and instant. It exists because a build whose specifiers are written inline, such as jsr:@zuke/git@^1, gets no signal from deno outdated at all — that reads manifests, and an inline specifier is in no manifest.",
  },
];

/** A built-in option flag (its long form), surfaced in help and completion. */
export interface BuiltinFlag {
  /** The flag, with its leading dashes (e.g. `--list`). */
  readonly name: string;
  /** One-line summary. */
  readonly description: string;
  /**
   * The reserved command this flag belongs to, when it only means something
   * there — `--allow-run` is `mcp`'s, `--keep` is `runs`'s.
   *
   * This is what lets the main help list the handful of flags that apply to
   * any run, and leave the rest to the command they qualify. Undefined means
   * the flag is general.
   */
  readonly command?: string;
  /** The full explanation, shown by the owning command's help. */
  readonly detail?: string;
}

/** Every built-in option flag, in completion order. */
export const BUILTIN_FLAGS: readonly BuiltinFlag[] = [
  { name: "--list", description: "List all targets with descriptions" },
  {
    name: "--json",
    description: "Print the build surface (commands, flags, targets) as JSON",
    detail:
      "With --list, print the build surface — commands, flags, targets and parameters — as JSON for tools and agents.",
  },
  { name: "--skip", description: "Skip the named dependency" },
  {
    name: "--parallel",
    description: "Run independent targets concurrently",
    detail:
      "Run independent targets concurrently. =N caps how many are in flight at once; the default is the CPU count.",
  },
  { name: "--no-cache", description: "Ignore the incremental cache" },
  {
    name: "--no-banner",
    description: "Do not print the opening banner (also ZUKE_NO_BANNER)",
    detail:
      "Do not print the opening banner — the Zuke wordmark, the framework and runtime versions with the platform, and the run id. ZUKE_NO_BANNER=1 does the same from the environment; the wordmark is already omitted on CI.",
  },
  {
    name: "--no-remote-cache",
    description: "Use the local cache only; skip the remote cache store",
    detail:
      "Use the local cache only; do not restore from or upload to the configured remote cache store.",
  },
  {
    name: "--affected",
    description: "Run only targets affected by changes since a git base",
    detail:
      "Run only targets affected by files changed since <base>, a git revision defaulting to HEAD. A target is affected when a changed file is under its declared inputs or when a dependency is affected; targets with no declared inputs always run.",
  },
  { name: "--dry-run", description: "Print the plan without running targets" },
  {
    name: "--state",
    description: "Persist durable run state to .zuke/runs",
    detail:
      "Persist durable run state under .zuke/runs — a run record with per-target status and metadata — unless a store is already configured via ZUKE_STATE_URL, ZUKE_STATE_DIR or the build's stateStore(). See docs/state.md.",
  },
  {
    name: "--actor",
    description: "Attribute the run to <name> in its state record",
    detail:
      'Attribute the run to <name> in its state record, else ZUKE_ACTOR, the CI actor, or "anonymous". Every resume rewrites it with whoever picked the run up.',
  },
  {
    name: "--actor-kind",
    description: "Who asked for the run: human (default) or service",
    detail:
      "Whether a person or a machine asked: human (the default) or service, else ZUKE_ACTOR_KIND. Recorded on the run's initiator which, unlike --actor, is stamped once at creation and never rewritten.",
  },
  {
    name: "--output",
    description: "Graph output format: text or html",
    command: "graph",
    detail:
      "Graph output format: text (the default terminal adjacency listing) or html.",
  },
  {
    name: "--no-open",
    description: "With --output=html, do not open a browser",
    command: "graph",
    detail: "With --output=html, write the page but do not open a browser.",
  },
  {
    name: "--check",
    description:
      "With generate-ci verify files; with resume re-check suspended runs",
    command: "generate-ci",
    detail:
      "Verify the declared CI files are current instead of writing them, failing if any has drifted. Use this on CI.",
  },
  {
    name: "--signal",
    description: "With resume, deliver a named external signal",
    command: "resume",
    detail: "Deliver a named external signal to the run.",
  },
  {
    name: "--data",
    description: "With resume --signal, the signal's JSON payload",
    command: "resume",
    detail: "With --signal, the signal's JSON payload (default {}).",
  },
  {
    name: "--force-graph",
    description: "With resume, continue even if the build graph changed",
    command: "resume",
    detail:
      "Continue even if the build graph changed since the run was suspended.",
  },
  {
    name: "--resume-degraded",
    description: "With resume, continue even if a state write was dropped",
    command: "resume",
    detail:
      "Continue even though the record is degraded — a state write was permanently lost while the run executed, so a target that succeeded may still be recorded running. Such a target is re-run, so use this only once you know it is safe to repeat.",
  },
  {
    name: "--update",
    description: "With outdated, bump the lock's resolved versions",
    command: "outdated",
    detail:
      "Move the lock's resolved versions up to the registry's latest instead of only reporting them. Takes optional package names to narrow it. Touches the lock and nothing else: a specifier that forbids the newer release is reported as holding its package back, never rewritten.",
  },
  {
    name: "--exit-code",
    description:
      "With outdated, exit non-zero when a package is behind or unchecked",
    command: "outdated",
    detail:
      "Exit non-zero when a package is behind or could not be checked, so a gate can fail on either — a run that reached nothing has not answered the question.",
  },
  {
    name: "--status",
    description: "With runs list, keep only runs with this status",
    command: "runs",
    detail:
      "With runs list, keep only runs with this status: running, suspended, succeeded, failed, or cancelled.",
  },
  {
    name: "--target",
    description: "With runs list, keep only runs whose graph has this target",
    command: "runs",
    detail: "With runs list, keep only runs whose graph contains this target.",
  },
  {
    name: "--since",
    description: "With runs list, keep only runs created at/after this time",
    command: "runs",
    detail:
      "With runs list, keep only runs created at or after this ISO-8601 timestamp.",
  },
  {
    name: "--limit",
    description: "With runs list, return at most this many runs (newest)",
    command: "runs",
    detail: "With runs list, return at most this many runs (the newest).",
  },
  {
    name: "--initiator",
    description: "With runs list, keep only runs this actor started",
    command: "runs",
    detail:
      "With runs list, keep only runs this initiator started. Falls back to the actor on a run recorded before initiators existed.",
  },
  {
    name: "--outcome",
    description: "With force, what the target settles to: skipped or succeeded",
    command: "force",
    detail:
      "What the target settles to without running: skipped takes the step off the plan, succeeded records that a person did it by hand, and a later cancel compensates it.",
  },
  {
    name: "--reason",
    description: "With force, why the target was forced (recorded on the run)",
    command: "force",
    detail:
      "Why it was forced — recorded on the run beside who forced it, and shown by runs show.",
  },
  {
    name: "--counts",
    description: "With runs list, print aggregate counts (total + per status)",
    command: "runs",
    detail:
      "With runs list, print aggregate counts: the total and one per status.",
  },
  {
    name: "--keep",
    description: "With runs prune, keep runs newer than this age (e.g. 90d)",
    command: "runs",
    detail:
      "With runs prune, keep runs newer than this age, e.g. 90d; older terminal runs become eligible for deletion.",
  },
  {
    name: "--keep-last",
    description: "With runs prune, always keep the newest N terminal runs",
    command: "runs",
    detail:
      "With runs prune, always keep the newest N terminal runs. Non-terminal runs, suspended or running, are never pruned.",
  },
  {
    name: "--allow-run",
    description:
      "With mcp, let agents run targets (optional =<glob-list> allow-list)",
    command: "mcp",
    detail:
      "Allow agents to execute targets, not just inspect them. An optional =<comma,globs> allow-list exposes only the matching targets as run tools; the others are invisible. Invoking a target runs its dependencies, so allow-listing one allows everything it does — scope this to entry points.",
  },
  {
    name: "--protect",
    description: "With mcp, require an operator token to run these targets",
    command: "mcp",
    detail:
      "Require an operator token, ZUKE_OPERATOR_TOKEN, as a tool-call argument before the matching targets may be run.",
  },
  {
    name: "--allowed-origin",
    description:
      "With mcp --http, an extra allowed Origin (repeatable; loopback-only otherwise)",
    command: "mcp",
    detail:
      "With --http, permit this browser Origin (repeatable). By default a loopback bind accepts only loopback origins, which is the drive-by and DNS-rebinding guard; a request with no Origin, such as a CLI client, is always allowed.",
  },
  {
    name: "--confirm-destructive",
    description: "With mcp, require confirm:true before a destructive run",
    command: "mcp",
    detail:
      "Make a destructive run tool return its plan instead of executing, unless it is called with confirm:true. A .readOnly() target is exempt.",
  },
  {
    name: "--registry",
    description:
      "With mcp, serve the build registry (dynamic pipeline discovery)",
    command: "mcp",
    detail:
      "Serve the build registry instead of this one build: expose every registered pipeline's targets as tools, re-read live so a newly-registered build appears with no restart. A run tool spawns the registered build's launch command, behind --allow-run and the same authorization. See docs/registry.md.",
  },
  {
    name: "--max-concurrent-runs",
    description:
      "With mcp --registry, cap concurrent run-tool spawns (default 4)",
    command: "mcp",
    detail:
      "With --registry, the most run-tool spawns allowed at once (default 4). A call past the cap gets an immediate busy error; read tools are never blocked or counted.",
  },
  {
    name: "--http",
    description: "With mcp, serve over HTTP on <host:port> instead of stdio",
    command: "mcp",
    detail:
      "Serve the streamable-HTTP transport on the given address instead of stdio. A bare <port> binds 127.0.0.1. A non-loopback host must authenticate its callers, with a bearer token (ZUKE_MCP_TOKEN) or an mcpAuth() authenticator on the build. Put real TLS in front for production. See docs/mcp.md.",
  },
  { name: "--help", description: "Show usage" },
];

/**
 * Every built-in flag's name without its leading dashes (`list`, `actor`,
 * `actor-kind`, …). The parser matches a built-in before a declared parameter
 * of the same name, so this is also the set of flags a build parameter may not
 * render as — {@link "./params.ts".discoverParameters} refuses one that does,
 * rather than letting the parameter sit there unreachable.
 */
export const BUILTIN_FLAG_NAMES: readonly string[] = BUILTIN_FLAGS.map((flag) =>
  flag.name.slice(2)
);

/**
 * What a usable flag name looks like: lowercase letters, digits and dashes,
 * starting with a letter.
 *
 * Shape, not just membership, is what makes {@link BUILTIN_FLAG_NAMES} a
 * sufficient check. The parser splits `--flag=value` at the first `=` and
 * matches the prefix, so a "flag" of `actor=mallory` is not in the built-in
 * list yet reaches the parser **as** `--actor` — landing a value on the
 * built-in and forging the run's actor. Anything with an `=`, a space, a
 * leading dash or a different case can mean something to the parser other than
 * what it says, so it is refused wherever a flag is declared or read.
 */
export const VALID_FLAG_NAME = /^[a-z][a-z0-9-]*$/;
