// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for `RuntimeTasks.chdir`. */

import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertThrows } from "../../../tests/_assert.ts";
import { withTemp } from "../../../tests/_temp.ts";
import { FileTasks } from "../src/file.ts";
import { RuntimeTasks } from "../src/runtime_tasks.ts";

test("RuntimeTasks.chdir moves the working directory that relative paths resolve against", async () => {
  await withTemp(async (dir) => {
    const before = RuntimeTasks.cwd();
    try {
      RuntimeTasks.chdir(dir);
      await FileTasks.writeText("marker", "here");
      assertEquals(await FileTasks.readText(`${dir}/marker`), "here");
    } finally {
      RuntimeTasks.chdir(before);
    }
    assertEquals(RuntimeTasks.cwd(), before);
  });
});

test("RuntimeTasks.chdir to a missing directory throws not found and stays put", async () => {
  await withTemp((dir) => {
    const before = RuntimeTasks.cwd();
    const error = assertThrows(() => RuntimeTasks.chdir(`${dir}/missing`));
    assertEquals(FileTasks.isNotFound(error), true);
    assertEquals(RuntimeTasks.cwd(), before);
  });
});
