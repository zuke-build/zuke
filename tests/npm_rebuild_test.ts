// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npmVerify`'s rebuild of a commit: the checkout's own commit is built in
 * place, any other in a worktree built by its own build code, and the worktree
 * is removed whatever the build does.
 *
 * @module
 */

import { absolutePath } from "../packages/core/mod.ts";
import { assertEquals, assertRejects } from "../packages/core/tests/_assert.ts";
import { rebuilder } from "../build/npm_rebuild.ts";

const HEAD = "a".repeat(40);

/** A rebuilder over fakes whose builds write `<tag>` as each package's `mod.js`. */
async function setup(fail = false) {
  const work = absolutePath(await Deno.makeTempDir());
  const log: string[] = [];
  const write = async (dist: string, pkgs: readonly string[], tag: string) => {
    for (const pkg of pkgs) {
      await Deno.mkdir(`${dist}/${pkg}`, { recursive: true });
      await Deno.writeTextFile(`${dist}/${pkg}/mod.js`, tag);
    }
  };
  const rebuild = rebuilder(work, {
    head: () => Promise.resolve(HEAD),
    addWorktree: async (dir, commit) => {
      log.push(`add ${commit}`);
      await Deno.mkdir(String(dir), { recursive: true });
    },
    removeWorktree: (dir) => {
      log.push(`remove ${String(dir).endsWith("tree-0") ? "tree-0" : "other"}`);
      return Promise.resolve();
    },
  }, {
    here: (pkgs, dist) => {
      log.push("here");
      return write(String(dist), pkgs, "here");
    },
    inTree: async (tree) => {
      log.push("in tree");
      if (fail) throw new Error("tsc failed");
      await write(String(tree("dist", "npm")), ["x", "y"], "tree");
    },
  });
  return { work, log, rebuild };
}

const text = (files: ReadonlyMap<string, Uint8Array> | undefined) =>
  new TextDecoder().decode(files?.get("mod.js"));

Deno.test("rebuilder: this checkout's commit is built in place, without a worktree", async () => {
  const { work, log, rebuild } = await setup();
  try {
    const built = await rebuild(HEAD, ["x"]);
    assertEquals(log, ["here"]);
    assertEquals(text(built.get("x")), "here");
  } finally {
    await Deno.remove(String(work), { recursive: true });
  }
});

Deno.test("rebuilder: another commit is built in a worktree that is then removed", async () => {
  const { work, log, rebuild } = await setup();
  try {
    const other = "b".repeat(40);
    const built = await rebuild(other, ["x", "y"]);
    assertEquals(log, [`add ${other}`, "in tree", "remove tree-0"]);
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
