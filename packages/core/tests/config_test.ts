// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { FileTasks, RuntimeTasks } from "../mod.ts";
import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertThrows } from "../../../tests/_assert.ts";
import { absolutePath } from "../src/path.ts";
import {
  CONFIG_FILE,
  findConfigDir,
  pathExists,
  repoRoot,
  repoRootFrom,
} from "../src/config.ts";
import { withTempCwd } from "../../../tests/_temp.ts";

test("findConfigDir returns the directory holding zuke.json", () => {
  const dir = findConfigDir(
    "/a/b/c",
    (p) => p === `/a/b/c/${CONFIG_FILE}`,
  );
  assertEquals(dir, "/a/b/c");
});

test("findConfigDir walks up to an ancestor", () => {
  const dir = findConfigDir("/a/b/c", (p) => p === `/a/${CONFIG_FILE}`);
  assertEquals(dir, "/a");
});

test("findConfigDir returns null when nothing is found", () => {
  assertEquals(findConfigDir("/a/b", () => false), null);
});

test("repoRootFrom resolves the root and joins segments", () => {
  const exists = (p: string) => p === `/proj/${CONFIG_FILE}`;
  assertEquals(repoRootFrom("/proj/pkg", exists, []).path, "/proj");
  assertEquals(
    repoRootFrom("/proj/pkg", exists, ["src", "main.ts"]).path,
    "/proj/src/main.ts",
  );
});

test("repoRootFrom throws a helpful error when not found", () => {
  assertThrows(
    () => repoRootFrom("/x", () => false, []),
    Error,
    "could not find zuke.json",
  );
});

test("pathExists reports existence and rethrows other errors", async () => {
  const file = await FileTasks.makeTempFile();
  try {
    assertEquals(pathExists(file), true);
    assertEquals(pathExists(`${file}-missing`), false);
    if (RuntimeTasks.os() !== "windows") {
      // Treating a file as a directory yields NotADirectory, not NotFound.
      assertThrows(() => pathExists(`${file}/child`));
    }
  } finally {
    await FileTasks.remove(file);
  }
});

test("repoRoot resolves from the current working directory", async () => {
  const dir = await FileTasks.makeTempDirectory();
  const original = RuntimeTasks.cwd();
  try {
    await FileTasks.writeText(`${dir}/${CONFIG_FILE}`, "{}\n");
    RuntimeTasks.chdir(dir);
    // Normalise the cwd the way AbsolutePath does (forward slashes), so the
    // assertion holds on Windows where Deno.cwd() uses backslashes.
    const here = absolutePath(RuntimeTasks.cwd()).path;
    assertEquals(repoRoot().path, here);
    assertEquals(repoRoot("src", "x.ts").path, `${here}/src/x.ts`);
  } finally {
    RuntimeTasks.chdir(original);
    await FileTasks.remove(dir, { recursive: true });
  }
});

test("repoRoot throws when no config exists above the cwd", async () => {
  await withTempCwd(() => {
    assertThrows(() => repoRoot(), Error, "could not find zuke.json");
  });
});
