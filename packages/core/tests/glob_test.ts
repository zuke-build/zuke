// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "./_assert.ts";
import { glob, globListing, globToRegExp } from "../src/glob.ts";
import { readDir } from "../src/fs.ts";
import { withTemp } from "./_temp.ts";

Deno.test("globToRegExp compiles the supported syntax", () => {
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

Deno.test("globToRegExp escapes regex metacharacters and unclosed braces", () => {
  assertEquals(globToRegExp("a.b+c").test("a.b+c"), true);
  assertEquals(globToRegExp("a.b+c").test("a-b-c"), false); // . and + are literal
  // An unclosed brace is matched literally.
  assertEquals(globToRegExp("a{b").test("a{b"), true);
});

Deno.test("glob expands patterns against a directory tree", async () => {
  await withTemp(async (dir) => {
    await Deno.mkdir(`${dir}/src/sub`, { recursive: true });
    await Deno.writeTextFile(`${dir}/src/a.ts`, "");
    await Deno.writeTextFile(`${dir}/src/b.js`, "");
    await Deno.writeTextFile(`${dir}/src/sub/c.ts`, "");
    await Deno.writeTextFile(`${dir}/top.ts`, "");

    assertEquals(await glob("src/**/*.ts", { cwd: dir }), [
      "src/a.ts",
      "src/sub/c.ts",
    ]);
    assertEquals(await glob("src/*.ts", { cwd: dir }), ["src/a.ts"]);
    assertEquals(await glob("*.ts", { cwd: dir }), ["top.ts"]);
  });
});

Deno.test("glob with no static base walks from cwd; missing base yields nothing", async () => {
  await withTemp(async (dir) => {
    await Deno.mkdir(`${dir}/pkg`);
    await Deno.writeTextFile(`${dir}/pkg/x.ts`, "");
    // A leading glob segment forces a walk from the root.
    assertEquals(await glob("**/*.ts", { cwd: dir }), ["pkg/x.ts"]);
    // A non-existent static base simply matches nothing.
    assertEquals(await glob("missing/**/*.ts", { cwd: dir }), []);
  });
});

Deno.test("glob matches an absolute pattern, whatever the cwd", async () => {
  await withTemp(async (dir) => {
    await Deno.mkdir(`${dir}/g/a`, { recursive: true });
    await Deno.mkdir(`${dir}/g/b`, { recursive: true });
    await Deno.writeTextFile(`${dir}/g/a/tsconfig.json`, "{}");
    await Deno.writeTextFile(`${dir}/g/b/tsconfig.json`, "{}");

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

Deno.test("glob defaults cwd to Deno.cwd()", async () => {
  const original = Deno.cwd();
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/only.ts`, "");
    Deno.chdir(dir);
    assertEquals(await glob("*.ts"), ["only.ts"]);
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("glob skips a directory removed after its parent was listed (#1096)", async () => {
  await withTemp(async (dir) => {
    for (const sub of ["keep", "gone"]) {
      await Deno.mkdir(`${dir}/${sub}`);
      await Deno.writeTextFile(`${dir}/${sub}/a_test.ts`, "");
    }
    // Another process removes `gone` once the walk has listed `dir`.
    const removing = async (path: string) => {
      if (path.endsWith("/gone")) await Deno.remove(path, { recursive: true });
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
