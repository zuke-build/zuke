// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npmVerify`'s comparison of what npm installed with the rebuild: the files,
 * the registry's metadata for the fields npm acts on, and the lockfile.
 *
 * @module
 */

import { assertEquals, assertRejects } from "../packages/core/tests/_assert.ts";
import {
  compareFiles,
  manifestProblems,
  NPM_ACTED_ON_FIELDS,
  readTree,
} from "../build/npm_installed.ts";
import { text } from "./_npm_verify.ts";

Deno.test("only an exact match of the installed files with the rebuild is accepted", () => {
  const rebuilt = new Map([
    ["package.json", text('{"name":"x","version":"1.0.0"}\n')],
    ["mod.js", text("export {};\n")],
    ["README.md", text("# x\n")],
  ]);
  assertEquals(compareFiles(new Map(rebuilt), rebuilt), []);
  // package.json by value: key order and whitespace do not matter.
  const reordered = new Map(rebuilt).set(
    "package.json",
    text('{ "version": "1.0.0", "name": "x" }'),
  );
  assertEquals(compareFiles(reordered, rebuilt), []);
  const changed = new Map(rebuilt).set("mod.js", text("export const x = 1;\n"))
    .set("extra.js", text(""));
  changed.delete("README.md");
  assertEquals(compareFiles(changed, rebuilt), [
    "README.md: in the rebuild, not installed from npm.",
    "extra.js: installed from npm, not in the rebuild.",
    "mod.js: differs from the rebuild.",
  ]);
  for (const manifest of ['{"name":"x","version":"9.9.9"}', "{"]) {
    assertEquals(
      compareFiles(
        new Map(rebuilt).set("package.json", text(manifest)),
        rebuilt,
      ),
      ["package.json: differs from the rebuild."],
    );
  }
});

Deno.test("readTree lists nested files by relative path, and refuses a symlink", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/src`);
    await Deno.writeTextFile(`${dir}/mod.js`, "m");
    await Deno.writeTextFile(`${dir}/src/a.js`, "a");
    assertEquals([...(await readTree(dir)).keys()].sort(), [
      "mod.js",
      "src/a.js",
    ]);
    if (Deno.build.os !== "windows") {
      await Deno.symlink(`${dir}/mod.js`, `${dir}/link.js`);
      await assertRejects(
        () => readTree(dir),
        Error,
        "link.js is not a regular file",
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("manifestProblems lists every field npm acts on and nothing else", () => {
  assertEquals(NPM_ACTED_ON_FIELDS.includes("scripts"), true);
  assertEquals(
    manifestProblems(
      { name: "x", extra: 1 },
      text('{"name":"x","files":["a"]}'),
    ),
    [],
  );
  assertEquals(manifestProblems({}, text("{")).length, 1);
  assertEquals(manifestProblems({}, undefined).length, 1);
});
