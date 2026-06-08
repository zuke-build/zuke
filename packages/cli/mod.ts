/**
 * `@zuke/cli` — the `zuke` command. Install it globally with
 *
 * ```sh
 * deno install -A -g -n zuke jsr:@zuke/cli
 * ```
 *
 * and scaffold Zuke into any project with `zuke setup`.
 */

import { defaultHost, runSetup, type SetupHost } from "./src/setup.ts";
import { VERSION } from "./src/version.ts";

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
    }
  }
  return flags;
}

const HELP = `zuke ${VERSION} — code-first build automation for Deno

Usage:
  zuke setup [options]   Scaffold Zuke into the current directory
  zuke --help            Show this help
  zuke --version         Show the version

Setup options:
  --name <Class>   Build class name for zuke.ts (default: MyBuild)
  --force, -f      Overwrite existing files
  --yes, -y        Accept defaults without prompting

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

  if (!flags.yes && prompter.interactive()) {
    name = prompter.ask("Build class name", name);
    if (!force) {
      force = prompter.confirm("Overwrite existing files if present?");
    }
  }

  host.log("Scaffolding Zuke into the current directory:");
  const result = await runSetup({ dir: ".", force, name }, host);
  const written = result.files.filter((f) => f.status !== "skipped").length;
  host.log(`Done — ${written} file(s) written. Next: ./zuke`);
  return 0;
}

/**
 * The CLI entry point. Returns a process exit code; `host`/`prompter` are
 * injectable for testing.
 */
export async function main(
  args: string[],
  host: SetupHost = defaultHost,
  prompter: Prompter = defaultPrompter,
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
  if (command === "setup") {
    return await commandSetup(rest, host, prompter);
  }
  host.log(`Unknown command: ${command}\n`);
  host.log(HELP);
  return 1;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
