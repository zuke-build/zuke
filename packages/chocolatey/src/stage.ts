// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Staging a rendered package on disk — the step `ChocolateyTasks.verify` and
 * `ChocolateyTasks.publish` share: check the package, write its files into a
 * fresh temporary directory, `choco pack` it there, and find the `.nupkg`.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { ChocoTasks } from "./choco.ts";
import type { ChocoSettings } from "./choco_settings.ts";
import type { ChocolateyPackage } from "./package.ts";
import { assertPackageId, assertPackageVersion } from "./package_identity.ts";

/**
 * A relative path inside a package: `/`-separated names of letters, digits,
 * `.`, `_` and `-`. The `.` and `..` segments are refused separately.
 */
const RELATIVE_PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

/** What applies the shared binary and environment to one `choco` call. */
export type ChocoCall = <S extends ChocoSettings>(settings: S) => S;

/**
 * Refuse a package that could not have been rendered: an invalid id or
 * version — both reach `choco` — a file path that would leave the staging
 * directory, or no `<id>.nuspec`.
 *
 * A {@link ChocolateyPackage} is plain data, so one built by hand reaches here
 * without the renderer's checks; these are the ones writing it depends on.
 *
 * @throws {Error} naming what is wrong.
 */
export function assertPackage(pkg: ChocolateyPackage): void {
  assertPackageId(pkg.id);
  assertPackageVersion(pkg.version);
  for (const path of Object.keys(pkg.files)) {
    const segments = path.split("/");
    if (
      !RELATIVE_PATH.test(path) ||
      segments.some((segment) => segment === "." || segment === "..")
    ) {
      throw new Error(
        `package file ${JSON.stringify(path)} must be a relative path of ` +
          `plain names, with no "." or ".." segment.`,
      );
    }
  }
  if (!Object.hasOwn(pkg.files, `${pkg.id}.nuspec`)) {
    throw new Error(
      `package ${JSON.stringify(pkg.id)} has no ${pkg.id}.nuspec among its ` +
        `files.`,
    );
  }
}

/** Write every file of `pkg` under `directory`, creating subdirectories. */
export async function writePackage(
  pkg: ChocolateyPackage,
  directory: string,
): Promise<void> {
  for (const [path, content] of Object.entries(pkg.files)) {
    const target = `${directory}/${path}`;
    await FileTasks.createDirectory(target.slice(0, target.lastIndexOf("/")));
    await FileTasks.writeText(target, content);
  }
}

/**
 * `choco pack` the package staged in `directory`, writing the `.nupkg` there
 * too, and return its file name.
 *
 * The nuspec is named relative to the directory, which is the working
 * directory of the call, so no absolute path ever reaches choco as an
 * operand. The `.nupkg` is found rather than predicted: choco v2 normalises
 * the version in the file name (`1.2.3.0` packs as `app.1.2.3.nupkg`).
 *
 * @throws {Error} when choco wrote no `.nupkg`, or more than one.
 */
export async function packPackage(
  pkg: ChocolateyPackage,
  directory: string,
  choco: ChocoCall,
): Promise<string> {
  await ChocoTasks.pack((s) =>
    choco(s).cwd(directory).nuspec(`${pkg.id}.nuspec`)
      .outputDirectory(directory)
  );
  const packed: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && entry.name.endsWith(".nupkg")) packed.push(entry.name);
  }
  const [nupkg] = packed;
  if (nupkg === undefined || packed.length > 1) {
    throw new Error(
      `choco pack wrote ${packed.length} .nupkg files for ` +
        `${JSON.stringify(pkg.id)}; expected exactly one.`,
    );
  }
  return nupkg;
}

/**
 * Run `steps` in order, every one even when an earlier one failed, and raise
 * what failed: the one error itself, or an `AggregateError` of several, the
 * first failure first — so a cleanup failure never hides the error that
 * mattered.
 */
export async function runAll(
  steps: ReadonlyArray<() => Promise<unknown>>,
  failure: string,
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, failure);
}

/** A fresh temporary directory, its prefix naming what it is for. */
export function stagingDirectory(purpose: string): Promise<string> {
  return Deno.makeTempDir({ prefix: `zuke-choco-${purpose}-` });
}

/** Remove a staging directory and everything in it. */
export async function removeStaging(directory: string): Promise<void> {
  await FileTasks.remove(directory, { recursive: true });
}

/** A {@link ChocoCall} running the `choco` at `toolPath`, when one is given. */
export function chocoAt(toolPath: string | undefined): ChocoCall {
  return <S extends ChocoSettings>(settings: S): S => {
    if (toolPath !== undefined) settings.toolPath(toolPath);
    return settings;
  };
}
