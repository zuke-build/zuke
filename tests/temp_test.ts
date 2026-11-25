// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for the temp-directory scopes in `_temp.ts`. */

import { FileTasks, RuntimeTasks } from "@zuke/core";
import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";
import { withTemp, withTempCwd } from "./_temp.ts";

test("withTemp makes its directory inside the requested parent, even with an empty prefix", async () => {
  await withTemp(async (parent) => {
    for (const prefix of ["", "named-"]) {
      await withTemp(async (dir) => {
        const name = dir.slice(dir.lastIndexOf("/") + 1);
        assertEquals(
          (await FileTasks.readDirectory(parent)).map((e) => e.name),
          [name],
        );
      }, { dir: parent, prefix });
    }
  });
});

test("withTempCwd runs in the directory, then restores the cwd and removes it", async () => {
  const before = RuntimeTasks.cwd();
  let made = "";
  await withTempCwd(async (dir) => {
    made = dir;
    // A file written relative to the cwd lands in the directory. Comparing
    // paths would not hold: macOS's temp directory is behind a symlink, and
    // Windows may name it by its short 8.3 form.
    await FileTasks.writeText("marker", "");
    assertEquals(await FileTasks.exists(`${dir}/marker`), true);
  });
  assertEquals(RuntimeTasks.cwd(), before);
  assertEquals(await FileTasks.exists(made), false);
});
