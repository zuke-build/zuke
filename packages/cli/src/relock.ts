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
 * is on.
 *
 * The old lock is copied to a backup file beside it before anything changes,
 * then emptied in place — written through, so a lock that is a symlink to a
 * shared file stays one — and `deno install --entrypoint zuke.ts
 * --frozen=false` resolves it afresh in the project root. A failed install
 * writes the old text back; a run that dies part-way leaves the backup on
 * disk, and the next `relock` refuses to start until it is dealt with.
 *
 * Only the entrypoints it is given are resolved: `zuke.ts`, plus any named on
 * the command line. A resolution only another program needed is dropped, and
 * the report names the JSR packages that went, so a shared lock is not
 * narrowed silently.
 *
 * `--min-dep-age` passes Deno's `--minimum-dependency-age` through, under the
 * name and value forms `outdated --update --min-dep-age` already takes. It
 * matters on Deno 2.9, which by default skips releases from the last day or
 * so: `--min-dep-age 0` resolves the newest published versions.
 *
 * @module
 */

import { lockedJsrSpecifiers } from "@zuke/core";
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

/** The suffix of the backup a run keeps while the lock is being rewritten. */
const BACKUP_SUFFIX = ".relock-backup";

/** `versions` for a report line: joined, or `none` when the lock had none. */
function shown(versions: readonly string[]): string {
  return versions.length > 0 ? versions.join(", ") : "none";
}

/**
 * Whether release `a` is older than release `b`, comparing the numeric core
 * only; `false` for anything this cannot read.
 */
function olderThan(a: string, b: string): boolean {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1, 4);
  const x = parse(a);
  const y = parse(b);
  if (x === undefined || y === undefined) return false;
  for (let i = 0; i < 3; i++) {
    if (Number(x[i]) !== Number(y[i])) return Number(x[i]) < Number(y[i]);
  }
  return false;
}

/** The emptied lock a run resolves into: `before`'s format version, no entries. */
function emptied(before: string): string {
  let version: unknown = "5";
  try {
    const parsed: unknown = JSON.parse(before);
    if (parsed !== null && typeof parsed === "object") {
      version = Reflect.get(parsed, "version") ?? version;
    }
  } catch {
    // An unreadable lock is still replaced; the default format is Deno 2's.
  }
  return `${JSON.stringify({ version }, null, 2)}\n`;
}

/** The JSR package names `lock` resolves. */
function jsrPackages(lock: string): Set<string> {
  return new Set(lockedJsrSpecifiers(lock).map((entry) => entry.name));
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
  // Regenerating is the point, so a lock the config freezes is not a reason
  // to refuse the write.
  const denoArgs = [
    ...installArgs("relock", flags, host.denoVersion()),
    "--frozen=false",
  ];
  const name = lockPath.startsWith(`${root}/`)
    ? lockPath.slice(root.length + 1)
    : lockPath;
  if (flags.dryRun) {
    log(`Would regenerate ${name}: deno ${denoArgs.join(" ")}`);
    return 0;
  }

  const backup = `${lockPath}${BACKUP_SUFFIX}`;
  let leftover = true;
  try {
    await host.readText(backup);
  } catch {
    leftover = false;
  }
  if (leftover) {
    throw new Error(
      `zuke relock: ${backup} is left from a relock that did not finish. ` +
        `It is the lock as it was before that run: move it back over ${name} ` +
        "to restore it, or delete it to keep the lock as it is, then run " +
        "zuke relock again.",
    );
  }

  let before: string | undefined;
  try {
    before = await host.readText(lockPath);
  } catch {
    // No lock yet: there is nothing to back up or put back.
  }
  if (before !== undefined) {
    await host.writeText(backup, before);
    await host.writeText(lockPath, emptied(before));
  }
  const restore = async () => {
    if (before !== undefined) await host.writeText(lockPath, before);
  };

  log(`Regenerating ${name}…`);
  let code: number;
  try {
    code = await host.deno(denoArgs, root);
  } catch (error) {
    await restore();
    if (before !== undefined) await host.remove(backup);
    throw error;
  }
  let after: string | undefined;
  if (code === 0) {
    try {
      after = await host.readText(lockPath);
    } catch {
      // Reported below.
    }
  }
  if (code !== 0 || after === undefined || after === emptied(before ?? "")) {
    await restore();
    if (before !== undefined) await host.remove(backup);
    log(paint.fail(
      code !== 0
        ? `zuke relock: deno install exited ${code}; ${name} is unchanged.`
        : `zuke relock: deno install wrote no ${name}${
          before === undefined ? "" : "; the old one is restored"
        }. In a workspace member, Deno keeps the lock at the workspace ` +
          "root: run zuke relock there.",
    ));
    return code !== 0 ? code : 1;
  }
  if (before !== undefined) await host.remove(backup);

  const was = lockedCoreVersions(before ?? "");
  const now = lockedCoreVersions(after);
  log(paint.ok(
    `Regenerated ${name}: @zuke/core ${
      shown(was) === shown(now) ? shown(now) : `${shown(was)} → ${shown(now)}`
    }`,
  ));
  if (
    was.length === 1 && now.length === 1 && olderThan(now[0], was[0]) &&
    flags.minDepAge === undefined
  ) {
    log(
      "Core resolved older than before: Deno's minimum dependency age " +
        "skips recent releases. Run zuke relock --min-dep-age 0 to resolve " +
        "the newest.",
    );
  }
  const kept = jsrPackages(after);
  const dropped = [...jsrPackages(before ?? "")].filter((p) => !kept.has(p));
  if (dropped.length > 0) {
    log(
      `No longer locked: ${dropped.join(", ")}. Only zuke.ts${
        flags.entrypoints.length > 0
          ? ` and ${flags.entrypoints.join(", ")}`
          : ""
      } were resolved; if another program in this project imports them, ` +
        "name it: zuke relock <entrypoint>.",
    );
  }
  return 0;
}
