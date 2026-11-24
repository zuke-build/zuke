// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for the temp-directory scopes in `_temp.ts`. */

import { stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";
import { withTemp, withTempCwd } from "./_temp.ts";

/** Whether `path` is there. */
function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

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
    // A file written relative to the cwd lands in the directory. Comparing
    // paths would not hold: macOS's temp directory is behind a symlink, and
    // Windows may name it by its short 8.3 form.
    await writeFile("marker", "");
    assertEquals(await exists(join(dir, "marker")), true);
  });
  assertEquals(process.cwd(), before);
  assertEquals(await exists(made), false);
});
