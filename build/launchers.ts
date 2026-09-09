// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Keeps the repository's own `./zuke` and `zuke.ps1` generated from the
 * launcher template `zuke setup` scaffolds (`packages/cli/src/launcher.ts`),
 * in its bootstrap variant. One template, one pin: a Deno bump is a change to
 * `packages/cli/src/deno_pin.ts`, a `./zuke launcherSync`, and a commit —
 * never a hand edit of a shell script that the CLI would then drift from.
 * `launcherSyncCheck` fails the gate on any drift, the same
 * generate-then-verify pattern as `build/plugin_sync.ts`.
 *
 * @module
 */

import { launcherBash, launcherPwsh } from "../packages/cli/src/launcher.ts";

/** The bash launcher's file name at the repository root. */
export const BASH_LAUNCHER = "zuke";

/** The PowerShell launcher's file name at the repository root. */
export const PWSH_LAUNCHER = "zuke.ps1";

/** The permission bits the bash launcher needs to be run as `./zuke`. */
const EXECUTABLE = 0o755;

/** The variant the repository runs on: nothing installed up front. */
const ROOT_VARIANT = { bootstrapDeno: true };

/** The launchers as they should be committed, keyed by file name. */
export function renderRootLaunchers(): ReadonlyMap<string, string> {
  return new Map([
    [BASH_LAUNCHER, launcherBash(ROOT_VARIANT)],
    [PWSH_LAUNCHER, launcherPwsh(ROOT_VARIANT)],
  ]);
}

/**
 * Write both launchers into `dir`, returning the paths written.
 *
 * Each file is written to a sibling temp path and renamed into place rather
 * than truncated and rewritten: `./zuke launcherSync` is itself started by the
 * bash launcher, and bash reads a script incrementally, so overwriting the
 * file it is executing could feed it garbage. A rename swaps the directory
 * entry while bash keeps the old inode open.
 */
export async function syncRootLaunchers(dir = "."): Promise<string[]> {
  const written: string[] = [];
  for (const [name, content] of renderRootLaunchers()) {
    const path = `${dir}/${name}`;
    const staging = `${path}.tmp-${crypto.randomUUID()}`;
    await Deno.writeTextFile(staging, content);
    if (name === BASH_LAUNCHER && Deno.build.os !== "windows") {
      await Deno.chmod(staging, EXECUTABLE);
    }
    await Deno.rename(staging, path);
    written.push(path);
  }
  return written;
}

/**
 * The launchers in `dir` that differ from the template, as
 * `<file> (<reason>)` lines; empty when both are current. Line endings are
 * normalised before comparing, so a Windows checkout that converted them
 * does not report drift the generator did not cause.
 */
export async function checkRootLaunchers(dir = "."): Promise<string[]> {
  const stale: string[] = [];
  for (const [name, expected] of renderRootLaunchers()) {
    const path = `${dir}/${name}`;
    let actual: string;
    try {
      actual = await Deno.readTextFile(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      stale.push(`${path} (missing)`);
      continue;
    }
    if (actual.replaceAll("\r\n", "\n") !== expected) {
      stale.push(`${path} (content differs from the template)`);
    }
  }
  return stale;
}
