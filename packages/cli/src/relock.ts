// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `zuke relock`: regenerate the project's lockfile from scratch.
 *
 * A project's own `zuke outdated --update` runs on the core the project's
 * lock pins, so a core whose update path is broken cannot move the project
 * off itself: core 1.66 dropped specifiers it still left in other packages'
 * dependency lists, and Deno then refused the whole lock. This command
 * belongs to the global CLI instead, so it works whatever core the project
 * is on. It sets the lock aside, runs `deno install --entrypoint zuke.ts` in
 * the project root, and puts the old lock back, byte for byte, if that fails.
 *
 * `--min-dep-age` passes Deno's `--minimum-dependency-age` through, under the
 * name and value forms `outdated --update --min-dep-age` already takes. It
 * matters on Deno 2.9, which by default skips releases from the last day or
 * so: `--min-dep-age 0` resolves the newest published versions.
 *
 * @module
 */

import type { BuildProbe } from "./dispatch.ts";
import type { CliPaint } from "./paint.ts";
import {
  installArgs,
  parseInstallFlags,
  type ProjectHost,
  projectRoot,
} from "./project.ts";
import {
  lockedCoreVersions,
  projectConfigText,
  projectLockPath,
} from "./version_report.ts";

/** `versions` for a report line: joined, or `none` when the lock had none. */
function shown(versions: readonly string[]): string {
  return versions.length > 0 ? versions.join(", ") : "none";
}

/**
 * Run `zuke relock <args>` from `cwd`, reporting through `log`, and return
 * the exit code.
 *
 * @throws {Error} with a message for the user when the request cannot be
 * carried out. `main` prints the message and exits 1.
 */
export async function runRelock(
  args: string[],
  log: (line: string) => void,
  host: ProjectHost,
  paint: CliPaint,
  cwd: string,
  probe: BuildProbe,
): Promise<number> {
  const flags = parseInstallFlags("relock", args);
  const root = await projectRoot(cwd, probe, "relock");
  const lockPath = projectLockPath(
    root,
    await projectConfigText((path) => host.readText(path), root),
  );
  if (lockPath === null) {
    throw new Error(
      "zuke relock: this project's deno.json disables its lock, or could " +
        "not be read as JSON, so there is no lock to regenerate.",
    );
  }
  const denoArgs = installArgs("relock", flags, host.denoVersion());
  const name = lockPath.startsWith(`${root}/`)
    ? lockPath.slice(root.length + 1)
    : lockPath;
  if (flags.dryRun) {
    log(`Would regenerate ${name}: deno ${denoArgs.join(" ")}`);
    return 0;
  }

  let before: string | undefined;
  try {
    before = await host.readText(lockPath);
  } catch {
    // No lock yet: there is nothing to set aside or put back.
  }
  const restore = async () => {
    if (before !== undefined) await host.writeText(lockPath, before);
  };
  if (before !== undefined) await host.remove(lockPath);

  log(`Regenerating ${name}…`);
  let code: number;
  try {
    code = await host.deno(denoArgs, root);
  } catch (error) {
    await restore();
    throw error;
  }
  if (code !== 0) {
    await restore();
    log(paint.fail(
      `zuke relock: deno install exited ${code}; ${name} is unchanged.`,
    ));
    return code;
  }
  let after: string;
  try {
    after = await host.readText(lockPath);
  } catch {
    await restore();
    log(paint.fail(
      `zuke relock: deno install wrote no ${name}; the old one is restored.`,
    ));
    return 1;
  }
  const was = shown(lockedCoreVersions(before ?? ""));
  const now = shown(lockedCoreVersions(after));
  log(paint.ok(
    `Regenerated ${name}: @zuke/core ${was === now ? now : `${was} → ${now}`}`,
  ));
  return 0;
}
