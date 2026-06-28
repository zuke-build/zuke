import { assertEquals } from "../../core/tests/_assert.ts";
import { diffToSuggestions } from "../src/diff_suggest.ts";

const PRELUDE = "note";

Deno.test("a modification hunk becomes a replacement suggestion", () => {
  const diff = [
    "diff --git a/zuke.ts b/zuke.ts",
    "--- a/zuke.ts",
    "+++ b/zuke.ts",
    "@@ -45,3 +45,3 @@",
    " context",
    '-const X = "remove me";',
    '+const _X = "remove me";',
    " more",
  ].join("\n");
  const s = diffToSuggestions(diff, PRELUDE);
  assertEquals(s.length, 1);
  assertEquals(s[0].path, "zuke.ts");
  assertEquals(s[0].startLine, 46); // line after the leading context
  assertEquals(s[0].line, 46);
  assertEquals(s[0].body.includes("```suggestion"), true);
  assertEquals(s[0].body.includes('const _X = "remove me";'), true);
  assertEquals(s[0].key, "zuke.ts:46");
});

Deno.test("a deletion hunk suggests an empty (delete) block", () => {
  const diff = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -10,1 +9,0 @@",
    "-const REMOVE = 1;",
  ].join("\n");
  const s = diffToSuggestions(diff, PRELUDE);
  assertEquals(s.length, 1);
  assertEquals(s[0].startLine, 10);
  assertEquals(s[0].line, 10);
  // An empty suggestion block deletes the targeted line on GitHub.
  assertEquals(s[0].body.includes("```suggestion\n```"), true);
});

Deno.test("a pure insertion is skipped (nothing to anchor)", () => {
  const diff = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -5,0 +6,1 @@",
    "+const ADDED = 1;",
  ].join("\n");
  assertEquals(diffToSuggestions(diff, PRELUDE), []);
});

Deno.test("multiple files and hunks each produce a suggestion", () => {
  const diff = [
    "diff --git a/one.ts b/one.ts",
    "--- a/one.ts",
    "+++ b/one.ts",
    "@@ -1,1 +1,1 @@",
    "-let a = 1;",
    "+const a = 1;",
    "diff --git a/two.ts b/two.ts",
    "--- a/two.ts",
    "+++ b/two.ts",
    "@@ -8,1 +8,1 @@",
    "-let b = 2;",
    "+const b = 2;",
  ].join("\n");
  const s = diffToSuggestions(diff, PRELUDE);
  assertEquals(s.map((x) => `${x.path}:${x.startLine}`), [
    "one.ts:1",
    "two.ts:8",
  ]);
});

Deno.test("an empty diff yields no suggestions", () => {
  assertEquals(diffToSuggestions("", PRELUDE), []);
});
