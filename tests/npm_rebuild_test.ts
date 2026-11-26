// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npmVerify`'s rebuild of a commit: every commit, this checkout's included,
 * is built in a clean worktree by its own build code, and the worktree is
 * removed whatever the build does.
 *
 * @module
 */

import { test } from "./_testing.ts";
import { absolutePath, FileTasks, RuntimeTasks } from "../packages/core/mod.ts";
import { assertEquals, assertRejects } from "./_assert.ts";
import {
  rebuildBuild,
  rebuilder,
  type RebuildGit,
  rebuildGit,
} from "../build/npm_rebuild.ts";

/** A rebuilder over fakes whose builds write `<tag>` as each package's `mod.js`. */
async function setup(fail = false) {
  const work = absolutePath(await FileTasks.makeTempDirectory());
  const log: string[] = [];
  const write = async (dist: string, pkgs: readonly string[]) => {
    for (const pkg of pkgs) {
      await FileTasks.createDirectory(`${dist}/${pkg}`);
      await FileTasks.writeText(`${dist}/${pkg}/mod.js`, "tree");
    }
  };
  const rebuild = rebuilder(work, {
    addWorktree: async (dir, commit) => {
      log.push(`add ${commit}`);
      await FileTasks.createDirectory(String(dir));
    },
    removeWorktree: (dir) => {
      log.push(`remove ${String(dir).endsWith("tree-0") ? "tree-0" : "other"}`);
      return Promise.resolve();
    },
  }, async (tree) => {
    log.push("in tree");
    if (fail) throw new Error("tsc failed");
    // The tree's build compiles every package, not only the ones asked for.
    await write(String(tree("dist", "npm")), ["core", "x", "y"]);
  });
  return { work, log, rebuild };
}

const text = (files: ReadonlyMap<string, Uint8Array> | undefined) =>
  new TextDecoder().decode(files?.get("mod.js"));

test("rebuilder: a commit is built in a worktree that is then removed", async () => {
  const { work, log, rebuild } = await setup();
  try {
    const other = "b".repeat(40);
    const built = await rebuild(other, ["x", "y"]);
    assertEquals(log, [`add ${other}`, "in tree", "remove tree-0"]);
    // Only the asked-for packages are read, from a build of all of them, so a
    // subset whose imports reach core still compiles.
    assertEquals([...built.keys()], ["x", "y"]);
    assertEquals(text(built.get("y")), "tree");
  } finally {
    await FileTasks.remove(String(work), { recursive: true });
  }
});

test("rebuilder: a failing build still removes its worktree and rejects", async () => {
  const { work, log, rebuild } = await setup(true);
  try {
    await assertRejects(
      () => rebuild("b".repeat(40), ["x"]),
      Error,
      "tsc failed",
    );
    assertEquals(log.at(-1), "remove tree-0");
  } finally {
    await FileTasks.remove(String(work), { recursive: true });
  }
});

test("rebuildGit: adds a detached worktree at the commit and force-removes it", async () => {
  const argv: string[][] = [];
  // Record each call's finished argv, then point git at a binary that cannot
  // exist, so no real git runs.
  const git = rebuildGit((s) => {
    argv.push(s.argv());
    return s.toolPath("/nonexistent/zuke-test-git");
  });
  const dir = absolutePath("/w/tree-0");
  await assertRejects(() => git.addWorktree(dir, "c".repeat(40)));
  await assertRejects(() => git.removeWorktree(dir));
  assertEquals(argv.map((a) => a.slice(1).join(" ")), [
    `worktree add --detach ${String(dir)} ${"c".repeat(40)}`,
    `worktree remove --force ${String(dir)}`,
  ]);
});

/** A git that checks a commit out as a tree holding `build`, as its build.ts. */
function fixtureGit(build: string, log: string[]): RebuildGit {
  return {
    addWorktree: async (dir) => {
      await FileTasks.createDirectory(String(dir));
      await FileTasks.writeText(String(dir("build.ts")), build);
    },
    removeWorktree: async (dir) => {
      log.push("removed");
      await FileTasks.remove(String(dir), { recursive: true });
    },
  };
}

// The real build adapter, run by the running deno against a tree's build.ts.
const DENO = rebuildBuild((s) => s.toolPath(RuntimeTasks.execPath()).quiet());

test({
  name: "rebuildBuild: runs the tree's own build.ts npmBuild in the tree",
  denoOnly: "runs a build.ts with deno run",
  fn: async () => {
    const work = absolutePath(await FileTasks.makeTempDirectory());
    const log: string[] = [];
    try {
      const build = `
      if (Deno.args.join(" ") !== "npmBuild") throw new Error("args");
      await Deno.mkdir("dist/npm/x", { recursive: true });
      await Deno.writeTextFile("dist/npm/x/mod.js", "built in tree");
    `;
      const rebuild = rebuilder(work, fixtureGit(build, log), DENO);
      const built = await rebuild("d".repeat(40), ["x"]);
      assertEquals(text(built.get("x")), "built in tree");
      assertEquals(log, ["removed"]);
    } finally {
      await FileTasks.remove(String(work), { recursive: true });
    }
  },
});

test("rebuildBuild: a build.ts that fails rejects, and the tree is removed", async () => {
  const work = absolutePath(await FileTasks.makeTempDirectory());
  const log: string[] = [];
  try {
    const rebuild = rebuilder(work, fixtureGit("Deno.exit(3);", log), DENO);
    await assertRejects(() => rebuild("d".repeat(40), ["x"]));
    assertEquals(log, ["removed"]);
  } finally {
    await FileTasks.remove(String(work), { recursive: true });
  }
});
