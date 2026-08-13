// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the `pluginSync`/`pluginSyncCheck`-style target wiring — sync
 * a source tree into a destination copy and fail the build on drift — driven
 * through the real CLI, mirroring how `zuke.ts`'s own `pluginSync` and
 * `pluginSyncCheck` targets are wired (see `zuke.ts` and
 * `build/plugin_sync.ts`).
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import {
  checkPluginSkillsSync,
  syncPluginSkills,
} from "../../build/plugin_sync.ts";
import { runCli } from "./_harness.ts";

/** A fixture build gating on drift between `source` and `dest`, like `pluginSyncCheck`. */
function gateBuild(source: string, dest: string) {
  class Gate extends Build {
    sync = target().executes(async () => {
      await syncPluginSkills(source, dest);
      console.log("synced");
    });
    check = target().executes(async () => {
      const stale = await checkPluginSkillsSync(source, dest);
      if (stale.length > 0) {
        throw new Error(`drifted:\n  ${stale.join("\n  ")}`);
      }
      console.log("in sync");
    });
  }
  return Gate;
}

Deno.test("pluginSyncCheck fails loudly when the destination has drifted", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const source = `${dir}/skills`;
    const dest = `${dir}/plugin-skills`;
    await Deno.mkdir(`${source}/a`, { recursive: true });
    await Deno.writeTextFile(`${source}/a/SKILL.md`, "hello");

    const { code, err } = await runCli(gateBuild(source, dest), ["check"]);
    assertEquals(code, 1);
    assertStringIncludes(err, "drifted");
    assertStringIncludes(err, "missing");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("pluginSync then pluginSyncCheck round-trips clean through the CLI", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const source = `${dir}/skills`;
    const dest = `${dir}/plugin-skills`;
    await Deno.mkdir(`${source}/a`, { recursive: true });
    await Deno.writeTextFile(`${source}/a/SKILL.md`, "hello");

    const Gate = gateBuild(source, dest);
    const synced = await runCli(Gate, ["sync"]);
    assertEquals(synced.code, 0);
    assertStringIncludes(synced.out, "synced");

    const checked = await runCli(Gate, ["check"]);
    assertEquals(checked.code, 0);
    assertStringIncludes(checked.out, "in sync");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
