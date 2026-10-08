// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What the global CLI's project commands share: `relock`, `cache`, `add` and
 * `remove` each run a `deno` command in the project root, so that working on
 * a Zuke project needs only `zuke`.
 *
 * They are the CLI's own rather than the build's because they must work
 * whatever core the project is on — including one too old, or too broken, to
 * update itself. The project is found the way forwarding finds it, through
 * the same trust gate.
 *
 * @module
 */

import { spawnDeno } from "./deno_path.ts";
import { BUILD_FILE, type BuildProbe, locateBuild } from "./dispatch.ts";
import { acceptsMinimumDependencyAge } from "./upgrade.ts";

/**
 * What the project commands reach outside the process, injectable so they
 * are testable without a real `deno`.
 */
export interface ProjectHost {
  /** Read a text file, rejecting when it cannot be read. */
  readText(path: string): Promise<string>;
  /** Write a text file, replacing what is there. */
  writeText(path: string, text: string): Promise<void>;
  /** Remove a file. */
  remove(path: string): Promise<void>;
  /** Run `deno <denoArgs>` in `cwd`, returning its exit code. */
  deno(denoArgs: string[], cwd: string): Promise<number>;
  /** The version of the Deno that runs the command. */
  denoVersion(): string;
}

/** The real {@link ProjectHost}: the file system, and `deno` in the root. */
export const defaultProjectHost: ProjectHost = {
  readText: (path) => Deno.readTextFile(path),
  writeText: (path, text) => Deno.writeTextFile(path, text),
  remove: (path) => Deno.remove(path),
  deno: async (denoArgs, cwd) => {
    const child = spawnDeno(denoArgs, {
      cwd,
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    });
    return (await child.status).code;
  },
  denoVersion: () => Deno.version.deno,
};

/**
 * The root of the project at or above `cwd`, through the trust gate.
 *
 * @throws {Error} naming `command` when there is no project, or when the
 * trust gate refuses the one there is.
 */
export async function projectRoot(
  cwd: string,
  probe: BuildProbe,
  command: string,
): Promise<string> {
  const location = await locateBuild(cwd, probe);
  if (location === null) {
    throw new Error(
      `zuke ${command}: no zuke.json in this directory or any parent, so ` +
        "there is no project to work on.",
    );
  }
  return location.root;
}

/** Flags accepted by the commands that resolve the build's module graph. */
export interface InstallFlags {
  /** Deno's `--minimum-dependency-age` value, when one was given. */
  minDepAge?: string;
  /** Report what would run, and change nothing. */
  dryRun: boolean;
}

/**
 * Parse `relock`'s or `cache`'s arguments: `--min-dep-age <value>` (or
 * `=<value>`) and `--dry-run`. Strict, so a mistyped option is refused rather
 * than ignored by a command that rewrites the lock.
 *
 * @throws {Error} naming `command` on an unknown option or a missing value.
 */
export function parseInstallFlags(
  command: string,
  args: readonly string[],
): InstallFlags {
  const flags: InstallFlags = { dryRun: false };
  const missing = () =>
    new Error(
      `zuke ${command}: --min-dep-age needs a value, such as 0 or P2D.`,
    );
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg.startsWith("--min-dep-age=")) {
      flags.minDepAge = arg.slice("--min-dep-age=".length);
      if (flags.minDepAge === "") throw missing();
    } else if (arg === "--min-dep-age") {
      const value = args[i + 1];
      if (value === undefined || value === "" || value.startsWith("-")) {
        throw missing();
      }
      flags.minDepAge = value;
      i++;
    } else {
      throw new Error(
        `zuke ${command}: unknown option ${arg}. It takes ` +
          "--min-dep-age <value> and --dry-run.",
      );
    }
  }
  return flags;
}

/**
 * The `deno install` argv that resolves the build's module graph into the
 * lock, honouring `--min-dep-age` when one was given.
 *
 * @throws {Error} naming `command` when a `--min-dep-age` was given and Deno
 * `denoVersion` does not accept the flag.
 */
export function installArgs(
  command: string,
  flags: InstallFlags,
  denoVersion: string,
): string[] {
  const args = ["install", "--entrypoint", BUILD_FILE];
  if (flags.minDepAge === undefined) return args;
  if (!acceptsMinimumDependencyAge(denoVersion)) {
    throw new Error(
      `zuke ${command}: Deno ${denoVersion} does not accept ` +
        "--minimum-dependency-age; upgrade Deno, or run without --min-dep-age.",
    );
  }
  return [...args, `--minimum-dependency-age=${flags.minDepAge}`];
}
