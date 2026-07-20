import { assertEquals } from "../../core/tests/_assert.ts";
import { filterDiff } from "../src/diff.ts";

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
