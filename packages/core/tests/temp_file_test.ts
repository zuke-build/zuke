// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for `FileTasks.makeTempFile` and `FileTasks.isAlreadyExists`. */

import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { FileTasks } from "../src/file.ts";

/** The last segment of `path`. */
function nameOf(path: string): string {
  return path.slice(
    Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1,
  );
}

test("makeTempFile makes an empty file, named zuke- by default, distinct each time", async () => {
  const first = await FileTasks.makeTempFile();
  const second = await FileTasks.makeTempFile();
  try {
    assertEquals(first === second, false);
    assertEquals(nameOf(first).startsWith("zuke-"), true);
    assertEquals(await FileTasks.readText(first), "");
    assertEquals((await FileTasks.stat(first)).isFile, true);
  } finally {
    await FileTasks.remove(first);
    await FileTasks.remove(second);
  }
});

test("makeTempFile names the file with the prefix and suffix it is given", async () => {
  const path = await FileTasks.makeTempFile((s) =>
    s.prefix("report-").suffix(".md")
  );
  try {
    const name = nameOf(path);
    assertEquals(name.startsWith("report-"), true);
    assertEquals(name.endsWith(".md"), true);
  } finally {
    await FileTasks.remove(path);
  }
});

test("makeTempFile refuses a prefix or suffix holding a path separator", async () => {
  await assertRejects(
    () => FileTasks.makeTempFile((s) => s.prefix("a/b")),
    TypeError,
    "prefix",
  );
  await assertRejects(
    () => FileTasks.makeTempFile((s) => s.suffix("\\x")),
    TypeError,
    "suffix",
  );
});

test("isAlreadyExists names a create that found something there, and nothing else", async () => {
  const path = await FileTasks.makeTempFile();
  try {
    const error = await assertRejects(() =>
      FileTasks.writeText(path, "x", (s) => s.createNew())
    );
    assertEquals(FileTasks.isAlreadyExists(error), true);
    assertEquals(FileTasks.isNotFound(error), false);
    assertEquals(FileTasks.isAlreadyExists(new Error("other")), false);
    assertEquals(FileTasks.isAlreadyExists("text"), false);
  } finally {
    await FileTasks.remove(path);
  }
});
