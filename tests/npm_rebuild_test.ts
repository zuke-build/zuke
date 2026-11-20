// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npmVerify`'s rebuild of a commit: every commit, this checkout's included,
 * is built in a clean worktree by its own build code, and the worktree is
 * removed whatever the build does.
 *
 * @module
 */

import { absolutePath } from "../packages/core/mod.ts";
import { assertEquals, assertRejects } from "../packages/core/tests/_assert.ts";
import { rebuilder } from "../build/npm_rebuild.ts";

/** A rebuilder over fakes whose builds write `<tag>` as each package's `mod.js`. */
async function setup(fail = false) {
  const work = absolutePath(await Deno.makeTempDir());
  const log: string[] = [];
  const write = async (dist: string, pkgs: readonly string[]) => {
    for (const pkg of pkgs) {
      await Deno.mkdir(`${dist}/${pkg}`, { recursive: true });
      await Deno.writeTextFile(`${dist}/${pkg}/mod.js`, "tree");
    }
  };
  const rebuild = rebuilder(work, {
    addWorktree: async (dir, commit) => {
      log.push(`add ${commit}`);
      await Deno.mkdir(String(dir), { recursive: true });
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

Deno.test("rebuilder: a commit is built in a worktree that is then removed", async () => {
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
    await Deno.remove(String(work), { recursive: true });
  }
});

Deno.test("rebuilder: a failing build still removes its worktree and rejects", async () => {
  const { work, log, rebuild } = await setup(true);
  try {
    await assertRejects(
      () => rebuild("b".repeat(40), ["x"]),
      Error,
      "tsc failed",
    );
    assertEquals(log.at(-1), "remove tree-0");
  } finally {
    await Deno.remove(String(work), { recursive: true });
  }
});
