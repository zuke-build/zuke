// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../_testing.ts";
import { assertEquals } from "../_assert.ts";
import { withTemp } from "../_temp.ts";
import { Build, FileTasks, glob, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

// A build that globs a *computed* absolute path — a directory it was told about
// rather than one under its own cwd — is where an absolute pattern silently
// matching nothing does its damage: the target finds no files, does nothing,
// and the run still reports success.
let root = "";

class ManifestBuild extends Build {
  manifests = target()
    .description("collect every manifest under an absolute root")
    .executes(async () => {
      const found = await glob(`${root}/*/deno.json`);
      console.log(`found=${found.length}`);
      for (const path of found) console.log(`path=${path}`);
    });
}

test("a target globbing an absolute path finds its files", async () => {
  await withTemp(async (dir) => {
    root = dir;
    await FileTasks.createDirectory(`${dir}/one`, { recursive: false });
    await FileTasks.createDirectory(`${dir}/two`, { recursive: false });
    await FileTasks.writeText(`${dir}/one/deno.json`, "{}");
    await FileTasks.writeText(`${dir}/two/deno.json`, "{}");

    const { code, out } = await runCli(ManifestBuild, ["manifests"]);
    assertEquals(code, 0, out);
    assertEquals(out.includes("found=2"), true, out);
    assertEquals(out.includes(`path=${dir}/one/deno.json`), true, out);
  });
});
