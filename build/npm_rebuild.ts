// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Rebuilding the npm packages of an arbitrary commit for `npmVerify`. The
 * commit's packages are built by the commit's own build code and toolchain
 * lock, in a git worktree: the bytes that were published were made by that
 * commit's `build/npm_*` and `build/npm_toolchain`, so building them with this
 * checkout's (newer or older) code would test this checkout's compiler
 * settings against another tree's sources, and report a difference that is not
 * one. Every commit, this checkout's included, is built from a clean worktree,
 * so uncommitted edits never take part, and each commit is built once whatever
 * its package count.
 */

import type { AbsolutePath } from "@zuke/core";
import { DenoTasks } from "@zuke/deno";
import { GitTasks } from "@zuke/git";
import { readTree } from "./npm_installed.ts";

/** The git operations a rebuild needs. */
export interface RebuildGit {
  /** Check `commit` out, detached, at the new directory `dir`. */
  addWorktree(dir: AbsolutePath, commit: string): Promise<void>;
  /** Remove the worktree at `dir`, with whatever the build left in it. */
  removeWorktree(dir: AbsolutePath): Promise<void>;
}

/** Run the build of the tree at `tree` that compiles every package into its `dist/npm`. */
export type RebuildBuild = (tree: AbsolutePath) => Promise<void>;

/** The real git. */
export const REBUILD_GIT: RebuildGit = {
  async addWorktree(dir, commit) {
    await GitTasks.worktree((s) => s.add(dir).detach().branch(commit));
  },
  async removeWorktree(dir) {
    await GitTasks.worktree((s) => s.remove(dir).force());
  },
};

/**
 * The real builds. A worktree is built by running its own `build.ts npmBuild`
 * with Deno, frozen to its own lock as `./zuke` would; it installs its own
 * toolchain under its own `.zuke`, so nothing is shared with this checkout.
 */
export const REBUILD_BUILD: RebuildBuild = async (tree) => {
  await DenoTasks.run((s) =>
    s.cwd(tree).allowAll().frozen().script("build.ts").scriptArgs("npmBuild")
  );
};

/**
 * A function that rebuilds `packages` from `commit` under `work` and returns
 * each one's files, removing the worktree it made, also when the build fails.
 */
export function rebuilder(
  work: AbsolutePath,
  git: RebuildGit,
  build: RebuildBuild,
): (
  commit: string,
  packages: readonly string[],
) => Promise<Map<string, ReadonlyMap<string, Uint8Array>>> {
  let trees = 0;
  const read = async (dist: AbsolutePath, packages: readonly string[]) => {
    const files = new Map<string, ReadonlyMap<string, Uint8Array>>();
    for (const pkg of packages) {
      files.set(pkg, await readTree(String(dist(pkg))));
    }
    return files;
  };
  return async (commit, packages) => {
    const tree = work(`tree-${trees++}`);
    await git.addWorktree(tree, commit);
    try {
      await build(tree);
      return await read(tree("dist", "npm"), packages);
    } finally {
      await git.removeWorktree(tree);
    }
  };
}
