// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/cli` — the `zuke` command. Install it globally with
 *
 * ```sh
 * deno install -A -g -n zuke jsr:@zuke/cli
 * ```
 *
 * scaffold Zuke into any project with `zuke setup`, then run its build from
 * anywhere inside the project with `zuke <target>`: every command that is not
 * the CLI's own (`setup`, `import`, `doc`, `upgrade`) is forwarded to the
 * nearest `zuke.ts`, exactly as the `./zuke` launcher would run it. Update the
 * installed CLI itself with `zuke upgrade`.
 *
 * @module
 */

import { ConsoleTasks } from "@zuke/console";
import {
  defaultHost,
  type McpSetupOptions,
  runSetup,
  type SetupHost,
  type SetupResult,
} from "./src/setup.ts";
import { type ImportSource, runImport } from "./src/import.ts";
import {
  defaultStarActions,
  promptStar,
  type StarActions,
} from "./src/star.ts";
import { VERSION } from "./src/version.ts";
import { DENO_PIN } from "./src/deno_pin.ts";
import {
  type BuildProbe,
  type BuildRunner,
  defaultBuildProbe,
  defaultBuildRunner,
  DENO_CONFIG_FILES,
  locateBuild,
  NO_LOCK_NOTICE,
  runBuild,
  runningNotice,
} from "./src/dispatch.ts";
import { absolutePath, resolveDocSpec } from "@zuke/core";
import { runDenoIsolated } from "./src/deno_isolated.ts";
import { defaultDenoHost, firstSet } from "./src/deno_path.ts";
import {
  defaultUpgradeHost,
  runUpgrade,
  type UpgradeHost,
} from "./src/upgrade.ts";
import { neutralise, output } from "./src/output.ts";
import { type CliPaint, invocationPaint } from "./src/paint.ts";
import {
  formatVersionPanel,
  homeRelative,
  lockedCoreVersions,
  projectLockPath,
  type VersionRow,
} from "./src/version_report.ts";

export type { SetupHost } from "./src/setup.ts";
export type { ImportSource } from "./src/import.ts";
export type { StarActions } from "./src/star.ts";
export type { UpgradeHost } from "./src/upgrade.ts";
export type {
  BuildLocation,
  BuildProbe,
  BuildRunner,
  Ownership,
} from "./src/dispatch.ts";

/**
 * The interactive surface, injectable so the wizard is testable without a TTY.
 */
export interface Prompter {
  /** Whether prompts should be shown (i.e. stdin is a terminal). */
  interactive(): boolean;
  /** Ask a free-text question, returning `fallback` if unanswered. */
  ask(question: string, fallback: string): string;
  /** Ask a yes/no question. */
  confirm(question: string): boolean;
}

/** The real {@link Prompter}, backed by Deno's `prompt`/`confirm`. */
export const defaultPrompter: Prompter = {
  interactive(): boolean {
    return Deno.stdin.isTerminal();
  },
  ask(question: string, fallback: string): string {
    // The default is shown in the question rather than prefilled: `prompt`
    // writes its text to the terminal itself, past the package's sink, and the
    // default is what the user typed on the command line (`--name`). Shown
    // neutralised, so the line cannot open a workflow command on a runner;
    // the value itself stays what was typed.
    const answer = prompt(neutralise(`${question} [${fallback}]`));
    return answer === null || answer === "" ? fallback : answer;
  },
  confirm(question: string): boolean {
    return confirm(question);
  },
};

/** Flags accepted by `zuke setup`. */
export interface SetupFlags {
  /** Overwrite existing files. */
  force: boolean;
  /** Skip prompts and accept defaults. */
  yes: boolean;
  /** Build class name for the starter `zuke.ts`. */
  name?: string;
  /** Directory to scaffold into (defaults to the current directory). */
  dir?: string;
  /** Base name for the launcher scripts, when `zuke` is taken by a directory. */
  launcherName?: string;
  /** Also write `.mcp.json`, registering the build's MCP server for agent clients. */
  mcp: boolean;
  /** Register that server with `--allow-run`, so the agent may execute targets. Implies `mcp`. */
  allowRun: boolean;
  /**
   * Which launchers to scaffold: `true` (`--bootstrap-deno`) for ones that
   * install a pinned, checksum-verified Deno when none is on `PATH`, `false`
   * (`--no-bootstrap-deno`) for ones that require it and fail closed. Unset:
   * ask when interactive, else take the default (bootstrap).
   */
  bootstrapDeno?: boolean;
}

/** Parse the argument list following `zuke setup`. */
export function parseSetupFlags(args: string[]): SetupFlags {
  const flags: SetupFlags = {
    force: false,
    yes: false,
    mcp: false,
    allowRun: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force" || arg === "-f") {
      flags.force = true;
    } else if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
    } else if (arg === "--mcp") {
      flags.mcp = true;
    } else if (arg === "--allow-run") {
      // Execution only makes sense for a registered server, so the flag
      // implies --mcp rather than being silently ignored without it.
      flags.mcp = true;
      flags.allowRun = true;
    } else if (arg === "--bootstrap-deno") {
      flags.bootstrapDeno = true;
    } else if (arg === "--no-bootstrap-deno") {
      flags.bootstrapDeno = false;
    } else if (arg === "--name") {
      if (i + 1 < args.length) {
        i++;
        flags.name = args[i];
      }
    } else if (arg.startsWith("--name=")) {
      flags.name = arg.slice("--name=".length);
    } else if (arg === "--dir") {
      if (i + 1 < args.length) {
        i++;
        flags.dir = args[i];
      }
    } else if (arg.startsWith("--dir=")) {
      flags.dir = arg.slice("--dir=".length);
    } else if (arg === "--launcher-name") {
      if (i + 1 < args.length) {
        i++;
        flags.launcherName = args[i];
      }
    } else if (arg.startsWith("--launcher-name=")) {
      flags.launcherName = arg.slice("--launcher-name=".length);
    }
  }
  return flags;
}

/** The `.mcp.json` request the flags make, or `undefined` for none. */
function mcpOption(flags: SetupFlags): McpSetupOptions | undefined {
  return flags.mcp ? { allowRun: flags.allowRun } : undefined;
}

/** The launcher question, naming the release a yes will pin. */
const BOOTSTRAP_QUESTION =
  `Launchers: bootstrap a pinned, checksum-verified Deno v${DENO_PIN.version} ` +
  "when none is on PATH? [y/n]";

/**
 * Which launchers to scaffold. A flag decides outright; otherwise the wizard
 * asks when it is interactive, and the default — bootstrap — stands under
 * `--yes` or a non-TTY. Only an explicit "n…" opts out, so Enter keeps the
 * default the question shows.
 */
function resolveBootstrapDeno(
  flags: SetupFlags,
  prompter: Prompter,
  interactive: boolean,
): boolean {
  if (flags.bootstrapDeno !== undefined) return flags.bootstrapDeno;
  if (!interactive) return true;
  return !/^n/i.test(prompter.ask(BOOTSTRAP_QUESTION, "y").trim());
}

/** The flag that asks for plain output, read here for the CLI's own commands. */
const PLAIN_FLAG = "--plain";

/** The environment that asks a spawned build for plain output. */
const PLAIN_ENV: Readonly<Record<string, string>> = { ZUKE_PLAIN: "1" };

/** The one-line identity printed under the logo and atop `--help`. */
const TAGLINE = `zuke ${VERSION} — code-first build automation for Deno`;

/**
 * Print the Zuke logo through `host`, so scaffolding opens with the brand.
 * Colour and log-level detection are `ConsoleTasks`'s (a TTY with `NO_COLOR`
 * unset paints the art; a pipe gets it plain; `ZUKE_LOG_LEVEL=silent` skips
 * it), while the lines themselves flow through the injectable host.
 */
function printBanner(host: SetupHost): void {
  ConsoleTasks.configure({
    sink: { out: (line) => host.log(line), err: (line) => host.log(line) },
  });
  ConsoleTasks.logo({ tagline: TAGLINE });
  // Point the process-global sink back at the console so nothing else in this
  // process (or a test's next case) keeps writing into this command's host.
  ConsoleTasks.reset();
  host.log("");
}

/**
 * The CLI's own half of the help: the commands that work anywhere, with no
 * project needed.
 *
 * Headed so a reader can tell it apart from the build's half, which is printed
 * after it when there is a project here. The two are different surfaces — this
 * one is the installed `zuke`, that one is whatever `zuke.ts` declares — and
 * showing them unlabelled under one heading was what made them look like one
 * inconsistent command.
 */
const HELP = `${TAGLINE}

Usage:
  zuke <command> [options]   A zuke command, anywhere (below)
  zuke <target>              A target of the build in this directory
  zuke -- <args>             Pass args straight to the build, unread

Zuke commands (available anywhere):
  setup [options]         Scaffold Zuke into a directory
  import [options]        Generate a build from package.json scripts or a Makefile
  doc <package>           Show a @zuke/* package's API docs (isolated resolution)
  upgrade [<version>]     Reinstall this CLI at the latest (or given) JSR release
  --help                  Show this help
  --version               Show the CLI's version, and this project's build's

Setup options:
  --dir <path>            Directory to scaffold into (default: .)
  --name <Class>          Build class name for zuke.ts (default: MyBuild)
  --launcher-name <name>  Launcher base name when a zuke/ directory is in the way
  --mcp                   Also write .mcp.json registering the build's MCP server
  --allow-run             …with --allow-run, so an agent may execute targets (implies --mcp)
  --bootstrap-deno        Launchers install a pinned, checksum-verified Deno when none is on PATH (default)
  --no-bootstrap-deno     Launchers require Deno on PATH and fail closed without it
  --force, -f             Overwrite existing files
  --yes, -y               Accept defaults without prompting

Import options:
  --dir <path>            Directory to read from and scaffold into (default: .)
  --name <Class>          Build class name for zuke.ts (default: MyBuild)
  --from <source>         Force a source: package.json or makefile (default: auto-detect)
  --mcp                   Also write .mcp.json registering the build's MCP server
  --allow-run             …with --allow-run, so an agent may execute targets (implies --mcp)
  --bootstrap-deno        Launchers install a pinned, checksum-verified Deno when none is on PATH (default)
  --no-bootstrap-deno     Launchers require Deno on PATH and fail closed without it
  --force, -f             Overwrite existing files
  --yes, -y               Accept defaults without prompting

Upgrade options:
  --dry-run               Say what would be installed, and install nothing
  --force, -f             Reinstall even when already on that version

Doc:
  zuke doc core           API of @zuke/core
  zuke doc @scope/pkg     API of a scoped package (or pass jsr:/npm:/https: as-is)`;

/**
 * {@link HELP} as `paint` renders it: headings marked, each row's command or
 * flag painted, every word in place. Plain paint returns it unchanged.
 */
function helpText(paint: CliPaint): string {
  if (!paint.rich) return HELP;
  return HELP.split("\n").map((line) => {
    if (line === TAGLINE) return paint.value(line);
    if (/^\S.*:$/.test(line)) return paint.heading(line);
    const row = /^( {2})(\S.*?)( {2,})(.*)$/.exec(line);
    if (row === null) return line;
    const [, indent, label, gap, description] = row;
    return `${indent}${paint.name(label)}${gap}${description}`;
  }).join("\n");
}

/** The heading that introduces the build's own half of the merged help. */
function buildHelpHeading(root: string): string {
  return `\n${"─".repeat(72)}\nThis project's build (${root}/zuke.ts) — ` +
    `run as \`zuke <target>\` or \`./zuke <target>\`:\n`;
}

/**
 * What to say where the build's half should have been, when the build was
 * found but did not describe itself — it failed to spawn, or its own `--help`
 * exited non-zero. The heading is already printed by then (the build inherits
 * stdio, so there is nothing to buffer and inspect first), which would
 * otherwise leave a heading over an empty section with only Deno's own error
 * to explain it. Named on stderr so stdout stays the help.
 */
const BUILD_HELP_FAILED =
  "The build was found but could not describe itself, so the section above " +
  "is empty. The CLI's own commands are unaffected.";

/** What to say when the build was found but could not report its version. */
const BUILD_VERSION_FAILED =
  "The build was found but could not report its version: a build on " +
  "@zuke/core older than 1.60.0 cannot answer --version, and this project " +
  "has no deno.lock naming its core to read instead. The CLI's own version " +
  "above is unaffected.";

/** What to say where the build's half would be, when there is no project. */
const NO_BUILD_NOTICE =
  `\n${"─".repeat(72)}\nNo zuke.json in this directory or any parent, so ` +
  `there is no build to describe here.\nRun \`zuke setup\` to scaffold one, ` +
  `then \`zuke --help\` also lists its targets.`;

/** Run the `setup` subcommand. */
async function commandSetup(
  args: string[],
  host: SetupHost,
  prompter: Prompter,
  starActions: StarActions,
  paint: CliPaint,
): Promise<number> {
  const flags = parseSetupFlags(args);
  let name = flags.name ?? "MyBuild";
  let force = flags.force;
  const dir = flags.dir ?? ".";

  if (paint.banner) printBanner(host);
  const interactive = !flags.yes && prompter.interactive();
  if (interactive) {
    name = prompter.ask("Build class name", name);
    if (!force) {
      force = prompter.confirm("Overwrite existing files if present?");
    }
  }
  const bootstrapDeno = resolveBootstrapDeno(flags, prompter, interactive);

  const where = dir === "." ? "the current directory" : dir;
  host.log(`Scaffolding Zuke into ${where}:`);
  const launcherName = flags.launcherName;
  const result = await runSetup(
    { dir, force, name, launcherName, mcp: mcpOption(flags), bootstrapDeno },
    host,
  );
  const written = result.files.filter((f) => f.status !== "skipped").length;
  reportNotes(host, result);
  if (result.manualSteps.length > 0) {
    reportManualSteps(host, result, `${written} file(s) written`, paint);
    return 1;
  }
  host.log(paint.ok(
    `Done — ${written} file(s) written. Next: ./${launcherName ?? "zuke"}`,
  ));
  if (interactive) {
    await promptStar(host, prompter, starActions);
  }
  return 0;
}

/** Print the advisory notes a scaffold run collected, if any. */
function reportNotes(host: SetupHost, result: SetupResult): void {
  for (const note of result.notes) host.log(`  note     ${note}`);
}

/**
 * Report a scaffold that could not be finished automatically.
 *
 * The files are on disk, but the build cannot run until the reader acts, so
 * this never prints `Next: ./zuke` — the caller returns a non-zero exit code.
 * A scaffold that claims success over a build that errors on its first import
 * is worse than one that says plainly what is left to do.
 */
function reportManualSteps(
  host: SetupHost,
  result: SetupResult,
  written: string,
  paint: CliPaint,
): void {
  host.log(paint.fail(
    `Incomplete — ${written}, but ${result.manualSteps.length} step(s) ` +
      `need you:`,
  ));
  for (const step of result.manualSteps) host.log(`  - ${step}`);
}

/** Flags accepted by `zuke import` — the setup flags plus `--from`. */
export interface ImportFlags extends SetupFlags {
  /** Force a source (`package.json` or `makefile`); auto-detected when unset. */
  from?: ImportSource;
}

/** Map a `--from` value to a source, or `undefined` when unrecognised. */
function parseSource(value: string): ImportSource | undefined {
  const lower = value.toLowerCase();
  if (lower === "package.json" || lower === "package") return "package.json";
  if (lower === "makefile") return "Makefile";
  return undefined;
}

/** Parse the argument list following `zuke import`. */
export function parseImportFlags(args: string[]): ImportFlags {
  const flags: ImportFlags = parseSetupFlags(args);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--from" && i + 1 < args.length) {
      flags.from = parseSource(args[++i]);
    } else if (arg.startsWith("--from=")) {
      flags.from = parseSource(arg.slice("--from=".length));
    }
  }
  return flags;
}

/** Run the `import` subcommand. */
async function commandImport(
  args: string[],
  host: SetupHost,
  prompter: Prompter,
  paint: CliPaint,
): Promise<number> {
  const flags = parseImportFlags(args);
  let name = flags.name ?? "MyBuild";
  let force = flags.force;
  const dir = flags.dir ?? ".";

  if (paint.banner) printBanner(host);
  const interactive = !flags.yes && prompter.interactive();
  if (interactive) {
    name = prompter.ask("Build class name", name);
    if (!force) {
      force = prompter.confirm("Overwrite existing files if present?");
    }
  }
  const bootstrapDeno = resolveBootstrapDeno(flags, prompter, interactive);

  const result = await runImport(
    {
      dir,
      force,
      name,
      from: flags.from,
      mcp: mcpOption(flags),
      bootstrapDeno,
    },
    host,
  );
  if (result.source === null) {
    host.log(paint.fail(
      "Nothing to import: no package.json scripts or Makefile found" +
        (flags.from ? ` for --from ${flags.from}` : "") + ".",
    ));
    return 1;
  }
  const written = result.files.filter((f) => f.status !== "skipped").length;
  reportNotes(host, result);
  if (result.manualSteps.length > 0) {
    reportManualSteps(
      host,
      result,
      `imported ${result.taskCount} task(s) from ${result.source}, ` +
        `${written} file(s) written`,
      paint,
    );
    return 1;
  }
  host.log(paint.ok(
    `Done — imported ${result.taskCount} task(s) from ${result.source}; ` +
      `${written} file(s) written. Next: ./zuke`,
  ));
  return 0;
}

/**
 * Runs `deno doc <args>` — the injectable subprocess seam for
 * {@link commandDoc}, so the command is testable without spawning `deno`.
 */
export type DocRunner = (denoArgs: string[]) => Promise<number>;

/**
 * The default {@link DocRunner}: `deno doc …` in an isolated temp dir, so the
 * surrounding repo's deno.json / node_modules / tsconfig don't drag
 * @types/node resolution noise into the output — the whole point of
 * `zuke doc` inside a Node project.
 */
const defaultDocRunner: DocRunner = (denoArgs) =>
  runDenoIsolated(denoArgs, "zuke-doc-");

/** Run the `doc` subcommand: `deno doc <spec>` in an isolated directory. */
async function commandDoc(
  args: string[],
  host: SetupHost,
  runner: DocRunner,
): Promise<number> {
  const [pkg, ...extra] = args;
  if (pkg === undefined || pkg === "" || pkg.startsWith("-")) {
    host.log(
      "zuke doc: name a package, e.g. `zuke doc core` or `zuke doc @scope/pkg`.",
    );
    return 1;
  }
  // A path would resolve against the runner's throwaway cwd — the resolver
  // pins it to the user's directory now, while cwd is still theirs. (Absolute
  // paths and `jsr:`/`npm:`/`https:` specifiers are location-independent.)
  return await runner(["doc", ...extra, resolveDocSpec(pkg, Deno.cwd())]);
}

/**
 * Forward `args` to the project's build: locate the nearest `zuke.json` above
 * the working directory (through `probe`, which also enforces the trust gate)
 * and run `zuke.ts` beside it through `runner`. Returns `null` when the
 * caller is not inside a project, so `main` can report the unknown command
 * instead. A refusal or a failed spawn is reported on **stderr** — stdout is
 * the build's, and under `zuke mcp` it is the JSON-RPC stream — and is exit 1.
 * Both reports bypass the log level: they are never the build's to silence.
 */
async function forwardToBuild(
  args: string[],
  probe: BuildProbe,
  runner: BuildRunner,
): Promise<number | null> {
  // The CLI's own stderr sink, not `ConsoleTasks`: `ZUKE_LOG_LEVEL` is a knob
  // for the build's output, and neither a security refusal nor the launchers'
  // unverified-lockfile notice may be silenced by it. The sink neutralises the
  // line on an Actions runner — the root and the error message below carry
  // text from the filesystem and from a failed spawn, not from Zuke.
  try {
    const cwd = Deno.cwd();
    const location = await locateBuild(cwd, probe);
    if (location === null) return null;
    // Discovery ran something the caller never named: say which, unless it
    // is the build right here, where `./zuke` would have been the same act.
    if (location.root !== absolutePath(cwd).path) {
      output.error(runningNotice(location.root));
    }
    // A launcher has its own lockfile story to tell; only the bare `deno run`
    // it stands in for is this notice's to report.
    if (location.launcher === null && !location.frozen) {
      output.error(NO_LOCK_NOTICE);
    }
    return await runBuild(runner, location, args);
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * `zuke --help`: this CLI's own commands, then — inside a project — the
 * build's.
 *
 * The two halves were separate programs' help, and from inside a project the
 * distinction was invisible: `zuke --help` and `./zuke --help` disagreed for
 * no reason a reader could see, and the build's surface was reachable only by
 * knowing to type `zuke -- --help`. Both are shown here, under headings that
 * say which is which.
 *
 * The build's half is produced by running the build's own `--help` rather than
 * rendered here. The CLI has no business knowing how a build describes itself,
 * and a second renderer is a second thing to drift.
 *
 * A build that fails to describe itself is not an error for this command:
 * the CLI's own help is still correct and still useful, so both shapes of
 * failure — a spawn that throws and a `--help` that exits non-zero — are
 * named on stderr and the exit stays 0. Help is what someone reaches for when
 * a project is already broken; refusing to print it then would be backwards.
 */
async function commandHelp(
  host: SetupHost,
  probe: BuildProbe,
  runner: BuildRunner,
  paint: CliPaint,
  childEnv: Readonly<Record<string, string>> | undefined,
): Promise<number> {
  host.log(helpText(paint));
  let location: Awaited<ReturnType<typeof locateBuild>> = null;
  try {
    location = await locateBuild(Deno.cwd(), probe);
  } catch (error) {
    // A refusal is not the same as an absence, and must not be reported as
    // one: the trust gate rejecting a `zuke.json` is exactly what someone
    // needs to be told, and "there is no build here" would hide it. Reported
    // on stderr, as the forwarding path reports it, because stdout is the
    // help. The CLI's own half is still correct, so this is not an error.
    output.error(error instanceof Error ? error.message : String(error));
    host.log(NO_BUILD_NOTICE);
    return 0;
  }
  if (location === null) {
    host.log(NO_BUILD_NOTICE);
    return 0;
  }
  host.log(buildHelpHeading(location.root));
  try {
    // The runner *returns* the build's exit code rather than throwing on one,
    // so a build whose `--help` runs and fails is reported here too — not
    // only one that fails to spawn. Left unread, that outcome was the one
    // path this command passed over without a word of its own.
    const code = await runBuild(runner, location, ["--help"], childEnv);
    if (code !== 0) output.error(BUILD_HELP_FAILED);
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    output.error(BUILD_HELP_FAILED);
  }
  return 0;
}

/**
 * `zuke --version`: this CLI's version, then — inside a project — the build's.
 *
 * Both numbers, because they differ for a real reason: `@zuke/cli` and
 * `@zuke/core` are separate packages on separate cadences, and a project pins
 * core through its own import map and lock. Reporting only one of them made
 * `zuke --version` and `./zuke --version` disagree with nothing to say which
 * had answered.
 *
 * In plain output the first line is the installed CLI's version, bare, so
 * anything reading `zuke --version` keeps working, and the build's follows
 * under a heading. On a terminal the same facts are one panel.
 *
 * The build's version is read from its lockfile — what the project
 * actually resolves, which the CLI's own linked core need not be — so nothing
 * is spawned, and a build on any core is answered. Only a project with no
 * lock, or a lock naming no core, has its build asked instead, plainly; a
 * build that cannot answer is reported and does not fail the command, since
 * the CLI's own version is still correct.
 *
 * Outside a project there is no second line and no notice. A version query is
 * not the place to explain what a project is, and `--help` already does.
 */
async function commandVersion(
  host: SetupHost,
  probe: BuildProbe,
  runner: BuildRunner,
  paint: CliPaint,
): Promise<number> {
  let location: Awaited<ReturnType<typeof locateBuild>> = null;
  let refusal: string | undefined;
  try {
    location = await locateBuild(Deno.cwd(), probe);
  } catch (error) {
    // A refused build is worth saying out loud even here: silence would read
    // as "no project", which is a different fact. On stderr, so the version
    // on stdout stays the one line a script reads.
    refusal = error instanceof Error ? error.message : String(error);
  }
  const core = location === null
    ? []
    : await projectCoreVersions(host, location.root);
  if (paint.rich) {
    const rows: VersionRow[] = [["cli", VERSION]];
    if (location !== null) {
      if (core.length > 0) rows.push(["core", core.join(", ")]);
      const home = firstSet(defaultDenoHost, "HOME", "USERPROFILE");
      rows.push([
        "project",
        homeRelative(location.root, home, defaultDenoHost.windows()),
      ]);
    }
    rows.push(["deno", Deno.version.deno]);
    rows.push(["platform", `${Deno.build.os}-${Deno.build.arch}`]);
    host.log(formatVersionPanel(rows, paint));
  } else {
    host.log(VERSION);
  }
  if (refusal !== undefined) output.error(refusal);
  if (location === null) return 0;
  if (core.length > 0) {
    // The panel already named it; plain output keeps the two-part shape it
    // always had, so a script reading the second line still finds it.
    if (!paint.rich) {
      host.log(
        `\nThis project's build (${location.root}/zuke.ts) runs on Zuke:`,
      );
      host.log(core.join(", "));
    }
    return 0;
  }
  // No lock to read, or none naming core: ask the build itself, as before.
  host.log(`\nThis project's build (${location.root}/zuke.ts) runs on Zuke:`);
  try {
    // Asked plainly whatever this invocation is, so the answer is the bare
    // version under the heading — never a second panel under the first.
    const code = await runBuild(runner, location, ["--version"], PLAIN_ENV);
    if (code !== 0) output.error(BUILD_VERSION_FAILED);
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    output.error(BUILD_VERSION_FAILED);
  }
  return 0;
}

/**
 * The `@zuke/core` versions the project at `root` resolves, read from the
 * lockfile its config points Deno at (`deno.lock` unless it names another);
 * empty when it has none, disables its lock, or names no core. Reading the
 * lock answers for a build on any core — asking the build only works from
 * core 1.60.0, where `--version` was added — and spawns nothing.
 */
async function projectCoreVersions(
  host: SetupHost,
  root: string,
): Promise<string[]> {
  const lock = projectLockPath(root, await firstConfigText(host, root));
  if (lock === null) return [];
  let text: string;
  try {
    text = await host.readText(lock);
  } catch {
    return [];
  }
  return lockedCoreVersions(text);
}

/**
 * The text of the first of {@link DENO_CONFIG_FILES} at `root` that can be
 * read, or `undefined` when there is none.
 */
async function firstConfigText(
  host: SetupHost,
  root: string,
): Promise<string | undefined> {
  for (const name of DENO_CONFIG_FILES) {
    try {
      return await host.readText(`${root}/${name}`);
    } catch {
      // Not there: try the next one Deno would.
    }
  }
  return undefined;
}

/**
 * The CLI entry point. Returns a process exit code; `host`, `prompter`,
 * `docRunner`, `starActions`, `buildRunner`, `buildProbe`, and `upgradeHost`
 * are injectable for testing.
 */
export async function main(
  args: string[],
  host: SetupHost = defaultHost,
  prompter: Prompter = defaultPrompter,
  docRunner: DocRunner = defaultDocRunner,
  starActions: StarActions = defaultStarActions,
  buildRunner: BuildRunner = defaultBuildRunner,
  buildProbe: BuildProbe = defaultBuildProbe,
  upgradeHost: UpgradeHost = defaultUpgradeHost,
): Promise<number> {
  // `--plain` belongs to whichever CLI answers. For the commands answered
  // here it is read and set aside; a command forwarded to the build keeps it
  // in its argv, where the build's own CLI reads it.
  const own = args.filter((arg) => arg !== PLAIN_FLAG);
  const plainFlag = own.length !== args.length;
  const paint = invocationPaint(
    plainFlag ? true : undefined,
    host.isTerminal?.bind(host),
  );
  if (own[0] === "--help" || own[0] === "-h") {
    // The build's half answers to the same request: an explicit --plain
    // reaches it as ZUKE_PLAIN, which a build on any core accepts, where the
    // flag would be refused by one older than core 1.67.0.
    const childEnv = plainFlag ? PLAIN_ENV : undefined;
    return await commandHelp(host, buildProbe, buildRunner, paint, childEnv);
  }
  const command = own[0];
  const rest = own.slice(1);

  if (command === "--version" || command === "-V") {
    return await commandVersion(host, buildProbe, buildRunner, paint);
  }
  try {
    if (command === "setup") {
      return await commandSetup(rest, host, prompter, starActions, paint);
    }
    if (command === "import") {
      return await commandImport(rest, host, prompter, paint);
    }
    if (command === "doc") {
      return await commandDoc(rest, host, docRunner);
    }
    if (command === "upgrade") {
      return await runUpgrade(
        rest,
        (line) => host.log(line),
        upgradeHost,
        paint,
      );
    }
  } catch (error) {
    // Surface a command's own friendly error (e.g. a setup directory collision)
    // as a clean message and non-zero exit, not an uncaught stack trace.
    host.log(
      paint.fail(error instanceof Error ? error.message : String(error)),
    );
    return 1;
  }
  // Not one of ours: inside a project it is the build's — `zuke ci`,
  // `zuke --list`, `zuke mcp`, and a bare `zuke` for the default target, as
  // `./zuke` — and the build's own CLI answers for it, unknown-target message
  // included. Outside any project a bare `zuke` has no build to run: it is
  // the usage.
  const forwarded = await forwardToBuild(args, buildProbe, buildRunner);
  if (forwarded !== null) return forwarded;
  if (own.length === 0) {
    host.log(helpText(paint));
    return 0;
  }
  host.log(
    `Unknown command: ${command} — and no zuke.json was found in the current ` +
      `directory or any parent to forward it to.\n`,
  );
  host.log(helpText(paint));
  return 1;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
