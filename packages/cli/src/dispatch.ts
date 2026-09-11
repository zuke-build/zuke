// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Forwarding a build command from the global `zuke` to the project's build.
 *
 * The global command (`deno install -A -g -n zuke jsr:@zuke/cli`) owns only
 * `setup`, `import` and `doc`. Everything else — `zuke ci`, `zuke --list`,
 * `zuke graph`, `zuke mcp` — belongs to the build in the current project, so
 * `main` forwards it: it walks up from the working directory to the nearest
 * `zuke.json` (the repository-root marker `zuke setup` writes), then runs
 * `zuke.ts` beside it exactly as the `./zuke` launcher would — `deno run -A`,
 * with `--frozen` once a `deno.lock` exists, from the root, stdio inherited.
 * That is the delegation a global `gradle` makes to a checkout's wrapper: one
 * global word, the project's own build and lock deciding what actually runs.
 *
 * Locating and planning are pure given a probe, so the routing is
 * unit-testable; the spawn goes through the injectable {@link BuildRunner}.
 *
 * @module
 */

import { absolutePath, CONFIG_FILE } from "@zuke/core";

/** The build file a forwarded command runs, beside {@link CONFIG_FILE}. */
export const BUILD_FILE = "zuke.ts";

/** The lockfile whose presence turns on `--frozen`, as in the launchers. */
export const LOCK_FILE = "deno.lock";

/** Where a forwarded command runs, and how. */
export interface BuildLocation {
  /** The absolute repository root: the directory holding `zuke.json`. */
  root: string;
  /** Whether a `deno.lock` sits at the root, so the run passes `--frozen`. */
  frozen: boolean;
}

/**
 * Walk up from `cwd` to the nearest directory holding {@link CONFIG_FILE},
 * probing with `exists`. Returns `null` when no ancestor has one — the caller
 * is not inside a Zuke project.
 */
export async function locateBuild(
  cwd: string,
  exists: (path: string) => Promise<boolean>,
): Promise<BuildLocation | null> {
  let dir = absolutePath(cwd);
  while (true) {
    if (await exists(dir(CONFIG_FILE).path)) {
      return { root: dir.path, frozen: await exists(dir(LOCK_FILE).path) };
    }
    if (dir.isRoot) return null;
    dir = dir.parent();
  }
}

/**
 * The `deno` argv for a forwarded command — the launchers' invocation, with
 * `--frozen` only when the location has a lockfile to verify against. Pure.
 */
export function buildRunArgs(
  location: BuildLocation,
  args: string[],
): string[] {
  return [
    "run",
    "-A",
    ...(location.frozen ? ["--frozen"] : []),
    BUILD_FILE,
    ...args,
  ];
}

/**
 * The launchers' notice for a run without a lockfile: a fresh scaffold has
 * none, so the first run must be allowed to write one, and saying so keeps a
 * deleted lockfile from downgrading verification silently.
 */
export const NO_LOCK_NOTICE =
  `zuke: no ${LOCK_FILE} here yet — running without lockfile verification so Deno can write one.`;

/**
 * Runs `deno <denoArgs>` from `root` and resolves to its exit code — the
 * injectable subprocess seam, so the forwarding is testable without a build.
 */
export type BuildRunner = (
  root: string,
  denoArgs: string[],
) => Promise<number>;

/**
 * The default {@link BuildRunner}: spawn the running Deno with stdio inherited
 * — `zuke mcp` speaks JSON-RPC over the same stdin/stdout, and a build may
 * prompt — and, as the launchers do, put that Deno first on the child's `PATH`
 * so CLIs the build provisions with `deno install` can find it by name.
 */
export const defaultBuildRunner: BuildRunner = async (root, denoArgs) => {
  const deno = Deno.execPath();
  const separator = Deno.build.os === "windows" ? ";" : ":";
  const inherited = Deno.env.get("PATH");
  const binDir = absolutePath(deno).parent().path;
  const path = inherited === undefined
    ? binDir
    : `${binDir}${separator}${inherited}`;
  const child = new Deno.Command(deno, {
    args: denoArgs,
    cwd: root,
    env: { PATH: path },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const { code } = await child.status;
  return code;
};
