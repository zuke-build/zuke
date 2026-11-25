// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { FileTasks, RuntimeTasks } from "../mod.ts";
import { chdir } from "../../../tests/_temp.ts";
import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { glob, globListing, globToRegExp } from "../src/glob.ts";
import { readDir } from "../src/fs.ts";
import { withTemp } from "../../../tests/_temp.ts";

test("globToRegExp compiles the supported syntax", () => {
  assertEquals(globToRegExp("*.ts").test("mod.ts"), true);
  assertEquals(globToRegExp("*.ts").test("a/mod.ts"), false); // * stops at /
  assertEquals(globToRegExp("src/**/*.ts").test("src/a/b/mod.ts"), true);
  assertEquals(globToRegExp("src/**/*.ts").test("src/mod.ts"), true); // **/ optional
  assertEquals(globToRegExp("a/**").test("a/b/c"), true); // ** spans /
  assertEquals(globToRegExp("?.ts").test("a.ts"), true);
  assertEquals(globToRegExp("?.ts").test("ab.ts"), false);
  assertEquals(globToRegExp("{a,b}.ts").test("a.ts"), true);
  assertEquals(globToRegExp("{a,b}.ts").test("b.ts"), true);
  assertEquals(globToRegExp("{a,b}.ts").test("c.ts"), false);
});

test("globToRegExp escapes regex metacharacters and unclosed braces", () => {
  assertEquals(globToRegExp("a.b+c").test("a.b+c"), true);
  assertEquals(globToRegExp("a.b+c").test("a-b-c"), false); // . and + are literal
  // An unclosed brace is matched literally.
  assertEquals(globToRegExp("a{b").test("a{b"), true);
});

test("glob expands patterns against a directory tree", async () => {
  await withTemp(async (dir) => {
    await FileTasks.createDirectory(`${dir}/src/sub`);
    await FileTasks.writeText(`${dir}/src/a.ts`, "");
    await FileTasks.writeText(`${dir}/src/b.js`, "");
    await FileTasks.writeText(`${dir}/src/sub/c.ts`, "");
    await FileTasks.writeText(`${dir}/top.ts`, "");

    assertEquals(await glob("src/**/*.ts", { cwd: dir }), [
      "src/a.ts",
      "src/sub/c.ts",
    ]);
    assertEquals(await glob("src/*.ts", { cwd: dir }), ["src/a.ts"]);
    assertEquals(await glob("*.ts", { cwd: dir }), ["top.ts"]);
  });
});

test("glob with no static base walks from cwd; missing base yields nothing", async () => {
  await withTemp(async (dir) => {
    await FileTasks.createDirectory(`${dir}/pkg`, { recursive: false });
    await FileTasks.writeText(`${dir}/pkg/x.ts`, "");
    // A leading glob segment forces a walk from the root.
    assertEquals(await glob("**/*.ts", { cwd: dir }), ["pkg/x.ts"]);
    // A non-existent static base simply matches nothing.
    assertEquals(await glob("missing/**/*.ts", { cwd: dir }), []);
  });
});

test("glob matches an absolute pattern, whatever the cwd", async () => {
  await withTemp(async (dir) => {
    await FileTasks.createDirectory(`${dir}/g/a`);
    await FileTasks.createDirectory(`${dir}/g/b`);
    await FileTasks.writeText(`${dir}/g/a/tsconfig.json`, "{}");
    await FileTasks.writeText(`${dir}/g/b/tsconfig.json`, "{}");

    // The matches come back absolute, and are the same files the relative
    // pattern finds against the same directory.
    assertEquals(await glob(`${dir}/g/*/tsconfig.json`), [
      `${dir}/g/a/tsconfig.json`,
      `${dir}/g/b/tsconfig.json`,
    ]);
    assertEquals(await glob("g/*/tsconfig.json", { cwd: dir }), [
      "g/a/tsconfig.json",
      "g/b/tsconfig.json",
    ]);
    // An absolute pattern names its own root, so a cwd cannot redirect it.
    assertEquals(await glob(`${dir}/g/*/tsconfig.json`, { cwd: "/nowhere" }), [
      `${dir}/g/a/tsconfig.json`,
      `${dir}/g/b/tsconfig.json`,
    ]);
    // A non-existent absolute base still matches nothing, as before.
    assertEquals(await glob(`${dir}/missing/*.ts`), []);
  });
});

test("glob defaults cwd to Deno.cwd()", async () => {
  const original = RuntimeTasks.cwd();
  const dir = await FileTasks.makeTempDirectory();
  try {
    await FileTasks.writeText(`${dir}/only.ts`, "");
    chdir(dir);
    assertEquals(await glob("*.ts"), ["only.ts"]);
  } finally {
    chdir(original);
    await FileTasks.remove(dir, { recursive: true });
  }
});

test("glob skips a directory removed after its parent was listed (#1096)", async () => {
  await withTemp(async (dir) => {
    for (const sub of ["keep", "gone"]) {
      await FileTasks.createDirectory(`${dir}/${sub}`, { recursive: false });
      await FileTasks.writeText(`${dir}/${sub}/a_test.ts`, "");
    }
    // Another process removes `gone` once the walk has listed `dir`.
    const removing = async (path: string) => {
      if (path.endsWith("/gone")) {
        await FileTasks.remove(path, { recursive: true });
      }
      return await readDir(path);
    };
    assertEquals(
      await globListing("**/*_test.ts", { cwd: dir }, removing),
      ["keep/a_test.ts"],
    );
    // Any other error reading a directory still rejects.
    await assertRejects(
      () =>
        globListing(
          "**/*.ts",
          { cwd: dir },
          (path) =>
            path.endsWith("/keep")
              ? Promise.reject(new Error("permission denied"))
              : readDir(path),
        ),
      Error,
      "permission denied",
    );
  });
});
