// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for what `FileTasks.readDirectory` says of each entry. */

import { test } from "../../../tests/_testing.ts";
import { assertEquals } from "../../../tests/_assert.ts";
import { withTemp } from "../../../tests/_temp.ts";
import { FileTasks } from "../src/file.ts";
import { RuntimeTasks } from "../src/runtime_tasks.ts";

test({
  name:
    "readDirectory tells a file, a directory and a link apart, a link being neither of the others",
  // Windows lets only an elevated process make a symbolic link.
  ignore: RuntimeTasks.os() === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      await FileTasks.writeText(`${dir}/file`, "x");
      await FileTasks.createDirectory(`${dir}/folder`);
      await FileTasks.symlink(`${dir}/folder`, `${dir}/link`);
      const entries = (await FileTasks.readDirectory(dir))
        .sort((a, b) => a.name.localeCompare(b.name));
      assertEquals(entries, [
        { name: "file", isFile: true, isDirectory: false, isSymlink: false },
        { name: "folder", isFile: false, isDirectory: true, isSymlink: false },
        { name: "link", isFile: false, isDirectory: false, isSymlink: true },
      ]);
    });
  },
});
