// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the plugin skills sync (`build/plugin_sync.ts`): the committed
 * `plugins/zuke/skills/` must byte-compare identical to `skills/`, since it
 * is a real copy (not a symlink) that a Windows clone without
 * `core.symlinks` would otherwise ship empty.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import {
  checkPluginSkillsSync,
  SKILLS_SOURCE,
  syncPluginSkills,
} from "../build/plugin_sync.ts";

Deno.test("the committed plugin skills copy matches skills/ exactly", async () => {
  assertEquals(await checkPluginSkillsSync(), []);
});

Deno.test("syncPluginSkills round-trips through generate then check", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Never sync into the committed default destination: syncPluginSkills
    // removes the destination before copying it back, so a run interrupted
    // between those two steps would leave the real, tracked
    // plugins/zuke/skills deleted from the working tree. Read the real
    // skills/ tree as the source, write only into the temp dir — and assert
    // that, so re-introducing the default destination fails the test.
    const dest = `${dir}/plugin-skills`;
    const written = await syncPluginSkills(SKILLS_SOURCE, dest);
    assertEquals(written.length > 0, true);
    assertEquals(written.every((path) => path.startsWith(`${dest}/`)), true);
    assertEquals(await checkPluginSkillsSync(SKILLS_SOURCE, dest), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a missing destination file is reported", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const source = `${dir}/source`;
    const dest = `${dir}/dest`;
    await Deno.mkdir(source, { recursive: true });
    await Deno.mkdir(dest, { recursive: true });
    await Deno.writeTextFile(`${source}/a.md`, "a");
    assertEquals(await checkPluginSkillsSync(source, dest), [
      `${dest}/a.md (missing)`,
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an extra destination file not in the source is reported", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const source = `${dir}/source`;
    const dest = `${dir}/dest`;
    await Deno.mkdir(source, { recursive: true });
    await Deno.mkdir(dest, { recursive: true });
    await Deno.writeTextFile(`${dest}/b.md`, "b");
    assertEquals(await checkPluginSkillsSync(source, dest), [
      `${dest}/b.md (extra, not present in ${source}/)`,
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a content mismatch is reported", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const source = `${dir}/source`;
    const dest = `${dir}/dest`;
    await Deno.mkdir(source, { recursive: true });
    await Deno.mkdir(dest, { recursive: true });
    await Deno.writeTextFile(`${source}/c.md`, "original");
    await Deno.writeTextFile(`${dest}/c.md`, "drifted");
    assertEquals(await checkPluginSkillsSync(source, dest), [
      `${dest}/c.md (content differs from ${source}/c.md)`,
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a missing destination directory reports every source file as missing", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const source = `${dir}/source`;
    const dest = `${dir}/dest-does-not-exist`;
    await Deno.mkdir(source, { recursive: true });
    await Deno.writeTextFile(`${source}/d.md`, "d");
    assertEquals(await checkPluginSkillsSync(source, dest), [
      `${dest}/d.md (missing)`,
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("syncPluginSkills copies nested directories and reports them written", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const source = `${dir}/source`;
    const dest = `${dir}/dest`;
    await Deno.mkdir(`${source}/nested`, { recursive: true });
    await Deno.writeTextFile(`${source}/top.md`, "top");
    await Deno.writeTextFile(`${source}/nested/deep.md`, "deep");
    const written = await syncPluginSkills(source, dest);
    assertEquals(written.sort(), [
      `${dest}/nested/deep.md`,
      `${dest}/top.md`,
    ]);
    assertEquals(await checkPluginSkillsSync(source, dest), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
