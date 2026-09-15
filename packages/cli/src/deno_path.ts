// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Finding the Deno that runs a project's build.
 *
 * Every subprocess this package spawns is Deno itself: the forwarded build
 * (`deno run -A zuke.ts …`) and `zuke doc` (`deno doc <spec>`). Under
 * `deno run` the executable running this code **is** Deno, so
 * `Deno.execPath()` names it and nothing has to be looked up — a project with
 * no ambient `deno` on `PATH` still works.
 *
 * Compiled with `deno compile` it is not. There `Deno.execPath()` is the
 * compiled binary, so spawning it re-enters the CLI: `deno doc core` becomes
 * `zuke doc core`, which spawns `zuke doc core` again, and a forwarded
 * `zuke ci` becomes `zuke run -A --frozen zuke.ts ci`, whose first argument is
 * not one of the CLI's own commands and is therefore forwarded too. Neither
 * terminates, and neither reports anything: the failure is unbounded process
 * creation rather than a message. `denoExecutable` in `@zuke/core` is what
 * tells the two cases apart — the same answer the build CLI's `doc` runner and
 * the MCP registry's module launch use — so this package adds only what is its
 * own: where to look when the compiled case has to find a Deno.
 *
 * The order mirrors the launchers, which answer the same question in shell:
 * whatever `PATH` resolves first, then the bootstrap directory they install
 * into (`DENO_INSTALL`, `~/.deno` by default). A candidate is tried by
 * spawning it rather than by walking `PATH` — the same choice
 * `ToolSettings.run` makes in `@zuke/core`, which lets the OS apply `PATHEXT`
 * on Windows instead of re-implementing it here.
 *
 * @module
 */

import { type AbsolutePath, absolutePath, denoExecutable } from "@zuke/core";
import { DENO_INSTALL_DOCS } from "./launcher.ts";

/**
 * The environment questions Deno resolution asks, injectable so the ordering
 * is testable without a second machine.
 */
export interface DenoHost {
  /** Whether this process is a `deno compile` binary rather than Deno itself. */
  standalone(): boolean;
  /** An environment variable's value, or `undefined` when it is unset. */
  env(name: string): string | undefined;
  /** Whether this platform is Windows, where the binary is `deno.exe`. */
  windows(): boolean;
}

/** The real, `Deno`-backed {@link DenoHost}. */
export const defaultDenoHost: DenoHost = {
  standalone: () => Deno.build.standalone,
  env: (name) => Deno.env.get(name),
  windows: () => Deno.build.os === "windows",
};

/** The first of `names` with a non-empty value, or `undefined` if none has one. */
function firstSet(host: DenoHost, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = host.env(name);
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

/**
 * The launchers' bootstrap directory: `DENO_INSTALL`, or `~/.deno`. `HOME` is
 * what the bash launcher reads; `USERPROFILE` is its Windows equivalent, where
 * `HOME` is often unset outside PowerShell. `undefined` when the environment
 * names no directory the candidate can be built from — none of the three set,
 * or a value that is not an absolute path — which leaves `PATH` as the only
 * candidate rather than a crash on the way to spawning anything.
 */
function installDir(host: DenoHost): AbsolutePath | undefined {
  const explicit = firstSet(host, "DENO_INSTALL");
  const home = firstSet(host, "HOME", "USERPROFILE");
  try {
    if (explicit !== undefined) return absolutePath(explicit);
    if (home !== undefined) return absolutePath(home)(".deno");
  } catch {
    // A relative `DENO_INSTALL` or `HOME` resolves against nothing meaningful
    // here, and `absolutePath` refuses it rather than guessing a base.
  }
  return undefined;
}

/**
 * The Deno executables to try, in order. The first is whatever
 * {@link denoExecutable} says Deno is here — the running executable under
 * `deno run`, the bare name for the OS to resolve on `PATH` when compiled —
 * and the rest is this package's own: the launchers' bootstrap directory, for
 * the compiled case where `PATH` may have no Deno at all.
 */
export function denoCandidates(host: DenoHost = defaultDenoHost): string[] {
  const candidates = [denoExecutable(host.standalone())];
  if (!host.standalone()) return candidates;
  const install = installDir(host);
  if (install !== undefined) {
    candidates.push(install("bin", host.windows() ? "deno.exe" : "deno").path);
  }
  return candidates;
}

/**
 * The environment overlay for a spawned Deno: its own directory first on
 * `PATH`, so a CLI the build provisions with `deno install` is found by name,
 * which is what the launchers do with the same directory. A bare name carries
 * no directory to prepend, and the `PATH` that resolved it already leads
 * where it should, so it overlays nothing.
 */
export function pathWithDeno(
  command: string,
  host: DenoHost = defaultDenoHost,
): Record<string, string> {
  if (!command.includes("/") && !command.includes("\\")) return {};
  const binDir = absolutePath(command).parent().path;
  // An empty `PATH` is unset, not an entry to append to: a zero-length element
  // is the POSIX spelling of "the current directory", so joining onto one
  // would put the build's own working directory on its children's `PATH` —
  // the same reading of an empty value {@link firstSet} makes above.
  const inherited = firstSet(host, "PATH");
  const separator = host.windows() ? ";" : ":";
  return {
    PATH: inherited === undefined
      ? binDir
      : `${binDir}${separator}${inherited}`,
  };
}

/** Thrown when no Deno could be found to run a build with. */
export class DenoNotFoundError extends Error {
  /** The error's name, as reported by `String(error)` and stack traces. */
  override name = "DenoNotFoundError";

  /**
   * Build the failure from the candidates that were tried, in order.
   *
   * @param tried The executables that were spawned and not found.
   */
  constructor(readonly tried: readonly string[]) {
    super(
      `zuke: running a build needs Deno, and none was found — tried ` +
        `${
          tried.join(", ")
        }. Install Deno (${DENO_INSTALL_DOCS}), or run the ` +
        `project's own ./zuke launcher, which installs a pinned Deno itself.`,
    );
  }
}

/**
 * What {@link spawnDeno} accepts: `Deno.Command`'s options without the two it
 * owns. The argv is the caller's `args`, and the environment carries the
 * resolved Deno's directory on `PATH`, which only this function knows.
 */
export type DenoSpawnOptions = Omit<Deno.CommandOptions, "args" | "env">;

/**
 * Whether `cwd` still names a directory to spawn in — vacuously true when the
 * caller named none and the child inherits this process's own.
 */
function cwdUsable(cwd: string | URL | undefined): boolean {
  if (cwd === undefined) return true;
  try {
    return Deno.statSync(cwd).isDirectory;
  } catch {
    return false;
  }
}

/**
 * Spawn Deno with `args`, trying each candidate in order and skipping the ones
 * that are not installed.
 *
 * `candidates` is this loop's own seam: the list is the only thing a test has
 * to vary to reach the skip and the not-found paths, which a real machine —
 * where a bare `deno` resolves — cannot produce. The resolution it defaults to
 * is pure and takes a {@link DenoHost} instead, so each layer is injected at
 * the level it decides something.
 *
 * @throws {DenoNotFoundError} when every candidate is missing.
 */
export function spawnDeno(
  args: string[],
  options: DenoSpawnOptions = {},
  candidates: readonly string[] = denoCandidates(),
): Deno.ChildProcess {
  const tried: string[] = [];
  for (const command of candidates) {
    tried.push(command);
    try {
      return new Deno.Command(command, {
        ...options,
        args,
        env: pathWithDeno(command),
      }).spawn();
    } catch (error) {
      // Not installed here; the next candidate may be. Anything else — a
      // permission denial, a directory where the binary should be — is the
      // caller's to see rather than a reason to keep looking. `spawn` reports
      // a `cwd` that is gone as `NotFound` as well, and no other Deno would
      // fix that: telling the user to install one they already have would send
      // them somewhere the problem is not.
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      if (!cwdUsable(options.cwd)) throw error;
    }
  }
  throw new DenoNotFoundError(tried);
}
