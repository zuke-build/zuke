// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `zuke doc` argument rule: sorting a package name from a path without
 * asking the filesystem.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { resolveDocSpec } from "../src/doc_spec.ts";

/** A stand-in working directory, so nothing here depends on where it runs. */
const CWD = "/work";

Deno.test("a bare name takes the @zuke scope", () => {
  // The shorthand the help advertises, and the reason this rule exists: it
  // used to work from the installed CLI and fail from the launcher.
  assertEquals(resolveDocSpec("core", CWD), "jsr:@zuke/core");
  assertEquals(resolveDocSpec("deno", CWD), "jsr:@zuke/deno");
});

Deno.test("a scoped name takes only the scheme", () => {
  assertEquals(resolveDocSpec("@scope/pkg", CWD), "jsr:@scope/pkg");
  // The slash after a leading @ is a scope separator, not a directory, so the
  // path rule below must not claim it.
  assertEquals(resolveDocSpec("@std/path", CWD), "jsr:@std/path");
});

Deno.test("a specifier that already names its target is untouched", () => {
  for (
    const spec of [
      "jsr:@zuke/deno",
      "npm:cowsay",
      "https://example.test/mod.ts",
      "file:///tmp/mod.ts",
    ]
  ) {
    assertEquals(resolveDocSpec(spec, CWD), spec);
  }
});

Deno.test("an absolute path is untouched, on either platform's spelling", () => {
  assertEquals(resolveDocSpec("/abs/mod.ts", CWD), "/abs/mod.ts");
  // A lone drive letter is not a URL scheme — which is why a scheme needs two
  // or more characters before its colon.
  assertEquals(resolveDocSpec("C:/repo/mod.ts", CWD), "C:/repo/mod.ts");
  assertEquals(resolveDocSpec("C:\\repo\\mod.ts", CWD), "C:\\repo\\mod.ts");
  assertEquals(resolveDocSpec("\\\\server\\share", CWD), "\\\\server\\share");
});

Deno.test("a relative path is joined to the given directory, normalised", () => {
  // `deno doc` runs from an isolated empty directory, so a relative spec has
  // to be made absolute while the caller's directory is still known. The
  // result is canonical: concatenating would leave `.` and `..` segments in
  // the specifier, which then appear verbatim in any error that echoes it.
  assertEquals(resolveDocSpec("./mod.ts", CWD), "/work/mod.ts");
  assertEquals(resolveDocSpec("../up/mod.ts", CWD), "/up/mod.ts");
  assertEquals(resolveDocSpec("src/mod.ts", CWD), "/work/src/mod.ts");
  assertEquals(resolveDocSpec("./a/../b.ts", CWD), "/work/b.ts");
});

Deno.test("a bare word ending in a source extension is a file, not a package", () => {
  // The case that separates the two old implementations: one read `mod.ts` as
  // a package called `@zuke/mod.ts`, which cannot exist.
  assertEquals(resolveDocSpec("mod.ts", CWD), "/work/mod.ts");
  assertEquals(resolveDocSpec("build.mjs", CWD), "/work/build.mjs");
  assertEquals(resolveDocSpec("deno.json", CWD), "/work/deno.json");
});

Deno.test("a dot inside a package name is not an extension", () => {
  // Only a known source extension makes an argument a file, so a package whose
  // name contains a dot still resolves as a package.
  assertEquals(resolveDocSpec("@scope/my.pkg", CWD), "jsr:@scope/my.pkg");
  assertEquals(resolveDocSpec("my.pkg", CWD), "jsr:@zuke/my.pkg");
});

Deno.test("the rule reads the directory it is given, not the process's", () => {
  // The cwd is a parameter so this is pure: the same input under two
  // directories differs only by the directory.
  assertEquals(resolveDocSpec("./m.ts", "/a"), "/a/m.ts");
  assertEquals(resolveDocSpec("./m.ts", "/b"), "/b/m.ts");
});
