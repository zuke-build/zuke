// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import { filterDiff, sectionFingerprints } from "../src/diff.ts";

/** A minimal one-file diff section for `path`. */
function section(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "",
  ].join("\n");
}

Deno.test("filterDiff excludes a file whose path contains a space", () => {
  const diff = section("src/my file.ts") + section("src/keep.ts");
  const out = filterDiff(diff, [], ["**/my file.ts"]);
  assertEquals(out.includes("my file.ts"), false); // dropped despite the space
  assertEquals(out.includes("keep.ts"), true);
});

Deno.test("filterDiff includes only matching files, parsing spaced paths", () => {
  const diff = section("src/a b.ts") + section("lib/c.ts");
  const out = filterDiff(diff, ["src/**"], []);
  assertEquals(out.includes("a b.ts"), true);
  assertEquals(out.includes("lib/c.ts"), false);
});

Deno.test("filterDiff keeps preamble but drops an unparseable file section when filters are active", () => {
  const preamble = "warning: some git advice\n";
  const weird = "diff --git \nBinary files differ\n"; // a file section, no path line
  const out = filterDiff(preamble + section("src/x.ts") + weird, [], [
    "**/*.lock",
  ]);
  assertEquals(out.includes("some git advice"), true); // preamble kept
  assertEquals(out.includes("src/x.ts"), true); // parseable file kept
  assertEquals(out.includes("Binary files differ"), false); // fail-safe: dropped
});

Deno.test("sectionFingerprints keys each file's section and moves with any byte of it", () => {
  const diff = section("src/a.ts") + section("src/b.ts");
  const prints = sectionFingerprints(diff);
  assertEquals([...prints.keys()], ["src/a.ts", "src/b.ts"]);
  // Identical sections fingerprint identically across runs; one changed
  // character in a file's section changes that file's print and no other.
  const again = sectionFingerprints(diff);
  assertEquals(again.get("src/a.ts"), prints.get("src/a.ts"));
  const moved = sectionFingerprints(
    section("src/a.ts").replace("+b", "+bb") + section("src/b.ts"),
  );
  assertEquals(moved.get("src/a.ts") === prints.get("src/a.ts"), false);
  assertEquals(moved.get("src/b.ts"), prints.get("src/b.ts"));
  // Non-file preamble and a section with no parsable path contribute nothing.
  assertEquals(sectionFingerprints("not a diff at all").size, 0);
});
