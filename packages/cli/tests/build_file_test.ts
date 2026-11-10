// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  assertBuildFileName,
  BUILD_FILE,
  buildFileNamed,
} from "../src/build_file.ts";

Deno.test("a zuke.json with no build field means zuke.ts, as before the field existed", () => {
  assertEquals(BUILD_FILE, "zuke.ts");
  for (const text of ['{ "name": "Acme" }', "{}", "", "not json", "[]", "5"]) {
    assertEquals(buildFileNamed(text), "zuke.ts", text);
  }
});

Deno.test("the build field names the build file", () => {
  assertEquals(buildFileNamed('{ "build": "build.ts" }'), "build.ts");
  for (const name of ["build.ts", "my-build_2.ts", ".hidden.ts", "a.b.ts"]) {
    assertEquals(assertBuildFileName(name), name);
  }
});

Deno.test("a build name that is not a plain .ts file name is refused, naming the field", () => {
  // The name goes into a shell script, a PowerShell script and a deno argv.
  for (
    const name of [
      "",
      ".ts",
      "-A.ts",
      "../build.ts",
      "dir/build.ts",
      "dir\\build.ts",
      "C:build.ts",
      "my build.ts",
      'a";calc;".ts',
      "$(id).ts",
      "`id`.ts",
      "a\nb.ts",
      "build.ts\n",
      "build.py",
      "build.js",
      "build",
    ]
  ) {
    assertThrows(() => assertBuildFileName(name), Error, "'build'");
  }
  for (const value of ["5", "null", '["build.ts"]', '{"a":1}', '"x y.ts"']) {
    assertThrows(
      () => buildFileNamed(`{ "build": ${value} }`),
      Error,
      "not a plain TypeScript file name",
    );
  }
});
