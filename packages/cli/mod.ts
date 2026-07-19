/**
 * `@zuke/cli` — the `zuke` command. Install it globally with
 *
 * ```sh
 * deno install -A -g -n zuke jsr:@zuke/cli
 * ```
 *
 * and scaffold Zuke into any project with `zuke setup`.
 *
 * @module
 */

import { defaultHost, runSetup, type SetupHost } from "./src/setup.ts";
import { type ImportSource, runImport } from "./src/import.ts";
import { VERSION } from "./src/version.ts";

export type { SetupHost } from "./src/setup.ts";
export type { ImportSource } from "./src/import.ts";

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
    const answer = prompt(question, fallback);
    return answer ?? fallback;
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
}

/** Parse the argument list following `zuke setup`. */
export function parseSetupFlags(args: string[]): SetupFlags {
  const flags: SetupFlags = { force: false, yes: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force" || arg === "-f") {
      flags.force = true;
    } else if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
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

const HELP = `zuke ${VERSION} — code-first build automation for Deno

Usage:
  zuke setup [options]    Scaffold Zuke into a directory
  zuke import [options]   Generate a build from package.json scripts or a Makefile
  zuke doc <package>      Show a @zuke/* package's API docs (isolated resolution)
  zuke --help             Show this help
  zuke --version          Show the version

Setup options:
  --dir <path>            Directory to scaffold into (default: .)
  --name <Class>          Build class name for zuke.ts (default: MyBuild)
  --launcher-name <name>  Launcher base name when a zuke/ directory is in the way
  --force, -f             Overwrite existing files
  --yes, -y               Accept defaults without prompting

Import options:
  --dir <path>     Directory to read from and scaffold into (default: .)
  --name <Class>   Build class name for zuke.ts (default: MyBuild)
  --from <source>  Force a source: package.json or makefile (default: auto-detect)
  --force, -f      Overwrite existing files
  --yes, -y        Accept defaults without prompting

Doc:
  zuke doc core           API of @zuke/core
  zuke doc @scope/pkg      API of a scoped package (or pass jsr:/npm:/https: as-is)

Run your build with the scaffolded launcher: ./zuke <target>`;

/** Run the `setup` subcommand. */
async function commandSetup(
  args: string[],
  host: SetupHost,
  prompter: Prompter,
): Promise<number> {
  const flags = parseSetupFlags(args);
  let name = flags.name ?? "MyBuild";
  let force = flags.force;
  const dir = flags.dir ?? ".";

  if (!flags.yes && prompter.interactive()) {
    name = prompter.ask("Build class name", name);
    if (!force) {
      force = prompter.confirm("Overwrite existing files if present?");
    }
  }

  const where = dir === "." ? "the current directory" : dir;
  host.log(`Scaffolding Zuke into ${where}:`);
  const launcherName = flags.launcherName;
  const result = await runSetup({ dir, force, name, launcherName }, host);
  const written = result.files.filter((f) => f.status !== "skipped").length;
  host.log(
    `Done — ${written} file(s) written. Next: ./${launcherName ?? "zuke"}`,
  );
  return 0;
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
): Promise<number> {
  const flags = parseImportFlags(args);
  let name = flags.name ?? "MyBuild";
  let force = flags.force;
  const dir = flags.dir ?? ".";

  if (!flags.yes && prompter.interactive()) {
    name = prompter.ask("Build class name", name);
    if (!force) {
      force = prompter.confirm("Overwrite existing files if present?");
    }
  }

  const result = await runImport({ dir, force, name, from: flags.from }, host);
  if (result.source === null) {
    host.log(
      "Nothing to import: no package.json scripts or Makefile found" +
        (flags.from ? ` for --from ${flags.from}` : "") + ".",
    );
    return 1;
  }
  const written = result.files.filter((f) => f.status !== "skipped").length;
  host.log(
    `Done — imported ${result.taskCount} task(s) from ${result.source}; ` +
      `${written} file(s) written. Next: ./zuke`,
  );
  return 0;
}

/**
 * Runs `deno doc <args>` — the injectable subprocess seam for
 * {@link commandDoc}, so the command is testable without spawning `deno`.
 */
export type DocRunner = (denoArgs: string[]) => Promise<number>;

/** The default {@link DocRunner}: spawn `deno doc …` in an isolated temp dir. */
const defaultDocRunner: DocRunner = async (denoArgs) => {
  // Run from a throwaway directory so the surrounding repo's deno.json /
  // node_modules / tsconfig don't drag @types/node resolution noise into the
  // output — the whole point of `zuke doc` inside a Node project.
  const cwd = await Deno.makeTempDir({ prefix: "zuke-doc-" });
  try {
    const { code } = await new Deno.Command(Deno.execPath(), {
      args: denoArgs,
      cwd,
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    return code;
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
};

/**
 * Resolve a `zuke doc` argument to a `deno doc` specifier: a bare package name
 * (`core`) becomes `jsr:@zuke/core`, a scoped name (`@scope/pkg`) becomes
 * `jsr:@scope/pkg`, and an explicit `jsr:`/`npm:`/`https:`/`file:`/path
 * specifier is passed through unchanged. Returns `undefined` for no argument.
 */
export function resolveDocSpec(pkg: string | undefined): string | undefined {
  if (pkg === undefined || pkg === "") return undefined;
  // Pass through anything already a specifier: a URI scheme (`jsr:`, `npm:`,
  // `https:`, `file:`, and a Windows `C:` drive), or a slash/dot path.
  if (/^([a-z][a-z0-9+.-]*:|[\\/]|\.)/i.test(pkg)) return pkg;
  return `jsr:${pkg.startsWith("@") ? pkg : `@zuke/${pkg}`}`;
}

/** Run the `doc` subcommand: `deno doc <spec>` in an isolated directory. */
async function commandDoc(
  args: string[],
  host: SetupHost,
  runner: DocRunner,
): Promise<number> {
  const [pkg, ...extra] = args;
  let spec = pkg === undefined || pkg.startsWith("-")
    ? undefined
    : resolveDocSpec(pkg);
  if (spec === undefined) {
    host.log(
      "zuke doc: name a package, e.g. `zuke doc core` or `zuke doc @scope/pkg`.",
    );
    return 1;
  }
  // A relative path would resolve against the runner's throwaway cwd — pin it to
  // the user's directory now, while cwd is still theirs. (Absolute paths and
  // `jsr:`/`npm:`/`https:` specifiers are already location-independent.)
  if (spec.startsWith(".")) spec = `${Deno.cwd()}/${spec}`;
  return await runner(["doc", ...extra, spec]);
}

/**
 * The CLI entry point. Returns a process exit code; `host`/`prompter`/`docRunner`
 * are injectable for testing.
 */
export async function main(
  args: string[],
  host: SetupHost = defaultHost,
  prompter: Prompter = defaultPrompter,
  docRunner: DocRunner = defaultDocRunner,
): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    host.log(HELP);
    return 0;
  }
  const command = args[0];
  const rest = args.slice(1);

  if (command === "--version" || command === "-V") {
    host.log(VERSION);
    return 0;
  }
  try {
    if (command === "setup") {
      return await commandSetup(rest, host, prompter);
    }
    if (command === "import") {
      return await commandImport(rest, host, prompter);
    }
    if (command === "doc") {
      return await commandDoc(rest, host, docRunner);
    }
  } catch (error) {
    // Surface a command's own friendly error (e.g. a setup directory collision)
    // as a clean message and non-zero exit, not an uncaught stack trace.
    host.log(error instanceof Error ? error.message : String(error));
    return 1;
  }
  host.log(`Unknown command: ${command}\n`);
  host.log(HELP);
  return 1;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
