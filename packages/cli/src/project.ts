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
import {
  type BuildLocation,
  type BuildProbe,
  locateBuild,
} from "./dispatch.ts";
import { acceptsMinimumDependencyAge } from "./upgrade.ts";

/**
 * What the project commands reach outside the process, injectable so they
 * are testable without a real `deno`.
 */
export interface ProjectHost {
  /**
   * What is at `path`, not following a link: a regular `file`, nothing
   * (`missing`), or `other` — a directory, or a link, which a write would
   * follow out of the project.
   */
  entry(path: string): Promise<"file" | "missing" | "other">;
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
  entry: async (path) => {
    try {
      return (await Deno.lstat(path)).isFile ? "file" : "other";
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return "missing";
      throw error;
    }
  },
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
 * The project at or above `cwd`, through the trust gate: its root, and the
 * build file its `zuke.json` names.
 *
 * Every caller works on the project's own Deno code — its build file, its
 * `deno.json` and the lock beside them — so a build another SDK hosts, which
 * has neither, is refused by name rather than handed to a `deno` command
 * that fails on a missing build file or writes a `deno.json` nothing reads.
 *
 * @throws {Error} naming `command` when there is no project, when the trust
 * gate refuses the one there is, or when it is a build another SDK hosts.
 */
export async function projectLocation(
  cwd: string,
  probe: BuildProbe,
  command: string,
): Promise<BuildLocation> {
  const location = await locateBuild(cwd, probe);
  if (location === null) {
    throw new Error(
      `zuke ${command}: no zuke.json in this directory or any parent, so ` +
        "there is no project to work on.",
    );
  }
  if (location.engine !== null) {
    throw new Error(
      `zuke ${command}: the project at ${location.root} is a build another ` +
        `SDK hosts, run on @zuke/engine ${location.engine}, with no ` +
        `${location.build} or deno.json of its own to work on. Its tool ` +
        "wrappers come with the SDK (zuke.tools in Python), and " +
        "zuke upgrade --engine moves the engine it runs on.",
    );
  }
  return location;
}

/** Flags accepted by the commands that resolve the build's module graph. */
export interface InstallFlags {
  /**
   * Entrypoints to resolve beside the build file — the other programs that share
   * the lock, such as an app's own `main.ts`.
   */
  entrypoints: string[];
  /** Deno's `--minimum-dependency-age` value, when one was given. */
  minDepAge?: string;
  /** Report what would run, and change nothing. */
  dryRun: boolean;
}

/**
 * Parse `relock`'s or `cache`'s arguments: further entrypoints, then
 * `--min-dep-age <value>` (or `=<value>`) and `--dry-run`. Strict, so a
 * mistyped option is refused rather than ignored by a command that rewrites
 * the lock.
 *
 * @throws {Error} naming `command` on an unknown option or a missing value.
 */
export function parseInstallFlags(
  command: string,
  args: readonly string[],
): InstallFlags {
  const flags: InstallFlags = { entrypoints: [], dryRun: false };
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
    } else if (!arg.startsWith("-")) {
      flags.entrypoints.push(arg);
    } else {
      throw new Error(
        `zuke ${command}: unknown option ${arg}. It takes further ` +
          "entrypoints, --min-dep-age <value> and --dry-run.",
      );
    }
  }
  return flags;
}

/**
 * The `deno install` argv that resolves the module graph of `build`, the
 * project's build file — and any
 * further entrypoints — into the lock, honouring `--min-dep-age` when one was
 * given.
 *
 * @throws {Error} naming `command` when a `--min-dep-age` was given and Deno
 * `denoVersion` does not accept the flag.
 */
export function installArgs(
  command: string,
  flags: InstallFlags,
  denoVersion: string,
  build: string,
): string[] {
  const args = ["install", "--entrypoint", build, ...flags.entrypoints];
  if (flags.minDepAge === undefined) return args;
  if (!acceptsMinimumDependencyAge(denoVersion)) {
    throw new Error(
      `zuke ${command}: Deno ${denoVersion} does not accept ` +
        "--minimum-dependency-age; upgrade Deno, or run without --min-dep-age.",
    );
  }
  return [...args, `--minimum-dependency-age=${flags.minDepAge}`];
}
