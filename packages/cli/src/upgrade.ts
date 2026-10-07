// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `zuke upgrade`: replace the globally installed CLI with another release
 * from JSR.
 *
 * The CLI cannot drift forward by itself. Since Deno 2, `deno install -g`
 * writes a lockfile beside the shim (`<root>/bin/.zuke/deno.lock`), which pins
 * `jsr:@zuke/cli@*` to the version resolved on install day, so the installed
 * `zuke` stays on that version until someone re-runs the install with
 * `--force`. This command does that re-run.
 *
 * The reinstall keeps the shim byte-for-byte identical whenever it targets
 * the latest release. It passes the same unversioned specifier as the
 * documented install, plus `--reload` so Deno re-reads the registry's
 * metadata, and only the lock moves. That matters on Windows, where the shim
 * is a `.cmd` file and is rewritten *while it is executing*: `cmd.exe`
 * resumes reading the batch file at its old byte offset once `deno` returns,
 * so a longer file would run the tail of its new last line as a command. Only
 * an explicit non-latest version pins a specifier into the shim, which grows
 * the file, so on Windows that one case is refused with the command to run
 * from another shell. Moving back to latest shrinks the file, which is safe.
 *
 * It only ever replaces an install that is there: the shim's own
 * `<root>/bin/.zuke/deno.json` must exist, so a one-off
 * `deno run jsr:@zuke/cli upgrade`, or an install under another `--root`,
 * is told so instead of gaining a second `zuke` in the default root.
 *
 * The command and its flags mirror `deno upgrade` (`[VERSION]`, `--dry-run`,
 * `--force`).
 *
 * @module
 */

import { absolutePath, httpJson } from "@zuke/core";
import { runDenoIsolated } from "./deno_isolated.ts";
import { defaultDenoHost, firstSet } from "./deno_path.ts";
import { VERSION } from "./version.ts";

/** The JSR package the global command is installed from. */
const PACKAGE = "jsr:@zuke/cli";

/** The registry document listing every published version and the latest. */
const META_URL = "https://jsr.io/@zuke/cli/meta.json";

/** A release version: a numeric core with an optional prerelease and build. */
const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * What `zuke upgrade` reaches outside the process, injectable so the
 * command is testable without the network or a real reinstall.
 */
export interface UpgradeHost {
  /**
   * The running CLI's main module (`Deno.mainModule`). Deno reports a JSR
   * program by its specifier, `jsr:@zuke/cli` or `jsr:@zuke/cli@<version>`.
   */
  mainModule(): string;
  /**
   * The directory `deno install -g` installs into (`<root>/bin`):
   * `DENO_INSTALL_ROOT`, else `~/.deno`, as Deno resolves it. `undefined`
   * when the environment names neither as an absolute path.
   */
  binDir(): string | undefined;
  /** Whether `path` exists. */
  exists(path: string): Promise<boolean>;
  /** Whether this is Windows, where the running shim is a `.cmd` file. */
  windows(): boolean;
  /** Fetch and parse `@zuke/cli`'s JSR `meta.json`. */
  meta(): Promise<unknown>;
  /** Run `deno <denoArgs>` to reinstall, returning its exit code. */
  install(denoArgs: string[]): Promise<number>;
}

/** The real {@link UpgradeHost}: `Deno.mainModule`, JSR, and `deno install`. */
export const defaultUpgradeHost: UpgradeHost = {
  mainModule: () => Deno.mainModule,
  binDir: () => {
    const explicit = firstSet(defaultDenoHost, "DENO_INSTALL_ROOT");
    const home = firstSet(defaultDenoHost, "HOME", "USERPROFILE");
    try {
      if (explicit !== undefined) return absolutePath(explicit)("bin").path;
      if (home !== undefined) return absolutePath(home)(".deno", "bin").path;
    } catch {
      // A relative value names no directory to look in.
    }
    return undefined;
  },
  exists: async (path) => {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      return false;
    }
  },
  windows: () => defaultDenoHost.windows(),
  meta: () => httpJson<unknown>(META_URL),
  install: (denoArgs) => runDenoIsolated(denoArgs, "zuke-upgrade-"),
};

/** Flags accepted by `zuke upgrade`. */
export interface UpgradeFlags {
  /** The exact release to install. When unset, the registry's latest. */
  version?: string;
  /** Report what would be installed, and install nothing. */
  dryRun: boolean;
  /** Reinstall even when the target is the running version. */
  force: boolean;
}

/**
 * Parse the argument list following `zuke upgrade`.
 *
 * This is stricter than `setup`'s parser: this command replaces the installed
 * executable, so a typo of `--dry-run` must stop it rather than be ignored on
 * the way to a real reinstall.
 *
 * @throws {Error} on an unknown flag, a second version, or a malformed one.
 */
export function parseUpgradeFlags(args: string[]): UpgradeFlags {
  const flags: UpgradeFlags = { dryRun: false, force: false };
  for (const arg of args) {
    if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--force" || arg === "-f") {
      flags.force = true;
    } else if (arg.startsWith("-")) {
      throw new Error(
        `zuke upgrade: unknown option ${arg}. Usage: zuke upgrade ` +
          "[<version>] [--dry-run] [--force]",
      );
    } else if (flags.version !== undefined) {
      throw new Error(
        `zuke upgrade: name one version, not ${flags.version} and ${arg}.`,
      );
    } else if (!VERSION_PATTERN.test(arg)) {
      throw new Error(
        `zuke upgrade: "${arg}" is not a version — name a release such as ` +
          "1.8.0.",
      );
    } else {
      flags.version = arg;
    }
  }
  return flags;
}

/** A field of a parsed JSON value, or `undefined` when it is not an object. */
function field(value: unknown, name: string): unknown {
  return value !== null && typeof value === "object"
    ? Reflect.get(value, name)
    : undefined;
}

/**
 * The release `flags` asks for, checked against the registry's `meta`.
 *
 * @throws {Error} when the document has no latest, or the requested version
 * is unpublished or yanked.
 */
function resolveTarget(meta: unknown, flags: UpgradeFlags): string {
  const latest = field(meta, "latest");
  if (typeof latest !== "string") {
    throw new Error(
      "zuke upgrade: JSR's metadata for @zuke/cli names no latest version.",
    );
  }
  if (flags.version === undefined) return latest;
  const entry = field(field(meta, "versions"), flags.version);
  if (entry === null || typeof entry !== "object") {
    throw new Error(
      `zuke upgrade: @zuke/cli ${flags.version} is not published on JSR ` +
        `(latest is ${latest}).`,
    );
  }
  if (field(entry, "yanked") === true) {
    throw new Error(
      `zuke upgrade: @zuke/cli ${flags.version} has been yanked from JSR ` +
        `(latest is ${latest}).`,
    );
  }
  return flags.version;
}

/**
 * The `deno install` argv that reinstalls the global command at `target`.
 * When `target` is the latest release, the specifier is unversioned (see the
 * module docs for why the shim must not change).
 */
export function installArgs(target: string, latest: boolean): string[] {
  const args = ["install", "--global", "--force", "--allow-all"];
  args.push("--name", "zuke");
  if (latest) return [...args, `--reload=${PACKAGE}`, PACKAGE];
  return [...args, `${PACKAGE}@${target}`];
}

/**
 * Run `zuke upgrade <args>`, reporting through `log`, and return the exit
 * code.
 *
 * @throws {Error} with a message for the user when the request cannot be
 * carried out. `main` prints the message and exits 1.
 */
export async function runUpgrade(
  args: string[],
  log: (line: string) => void,
  host: UpgradeHost,
): Promise<number> {
  const flags = parseUpgradeFlags(args);
  const running = host.mainModule();
  if (running !== PACKAGE && !running.startsWith(`${PACKAGE}@`)) {
    // A local checkout or a `deno compile` binary. Reinstalling from JSR
    // would put a different executable on PATH and leave this one, the one
    // actually running, exactly as it was.
    throw new Error(
      `zuke upgrade: this zuke runs ${running}, not ${PACKAGE}, so ` +
        "reinstalling from JSR would not update it. Update it where it came " +
        "from.",
    );
  }
  const binDir = host.binDir();
  const marker = binDir === undefined
    ? undefined
    : absolutePath(binDir)(".zuke", "deno.json").path;
  if (marker === undefined || !(await host.exists(marker))) {
    throw new Error(
      "zuke upgrade: found no global install of zuke to replace" +
        (marker === undefined
          ? " (neither DENO_INSTALL_ROOT nor a home directory is set)"
          : ` (no ${marker})`) +
        ". Install it with: deno install -A -g -n zuke " + PACKAGE,
    );
  }
  let meta: unknown;
  try {
    meta = await host.meta();
  } catch (error) {
    throw new Error(
      "zuke upgrade: could not read @zuke/cli's versions from JSR: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  const target = resolveTarget(meta, flags);
  if (target === VERSION && !flags.force) {
    log(
      `zuke ${VERSION} is already ${
        flags.version === undefined ? "the latest release" : "installed"
      }. Pass --force to reinstall it.`,
    );
    return 0;
  }
  const latest = target === field(meta, "latest");
  const denoArgs = installArgs(target, latest);
  if (!latest && host.windows()) {
    throw new Error(
      `zuke upgrade: on Windows, installing ${target} would rewrite the ` +
        "zuke.cmd running this command into a longer file, and cmd.exe " +
        "would then run a fragment of it. Run this from another shell " +
        `instead: deno ${denoArgs.join(" ")}`,
    );
  }
  if (flags.dryRun) {
    log(
      `Would replace zuke ${VERSION} with ${target}: deno ${
        denoArgs.join(" ")
      }`,
    );
    return 0;
  }
  log(`Replacing zuke ${VERSION} with ${target}…`);
  const code = await host.install(denoArgs);
  if (code !== 0) {
    // Not "still on the old version": a forced install that failed part-way
    // may have replaced some of it, and Deno's own output above says how far.
    log(`zuke upgrade: deno install exited ${code}; see its output above.`);
    return code;
  }
  log(`Done — zuke ${target} is installed. Check with: zuke --version`);
  return 0;
}
