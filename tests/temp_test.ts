// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for the temp-directory scopes in `_temp.ts`. */

import { realpath, stat } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";
import { withTemp, withTempCwd } from "./_temp.ts";

test("withTemp makes its directory inside the requested parent, even with an empty prefix", async () => {
  await withTemp(async (parent) => {
    for (const prefix of ["", "named-"]) {
      await withTemp((dir) => {
        assertEquals(dirname(dir), parent);
      }, { dir: parent, prefix });
    }
  });
});

test("withTempCwd runs in the directory, then restores the cwd and removes it", async () => {
  const before = process.cwd();
  let made = "";
  await withTempCwd(async (dir) => {
    made = dir;
    // The real path: macOS's temp directory is behind a symlink.
    assertEquals(process.cwd(), await realpath(dir));
  });
  assertEquals(process.cwd(), before);
  assertEquals(await stat(made).then(() => true, () => false), false);
});
