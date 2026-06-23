import { assertEquals } from "./_assert.ts";
import { callerModule, isEntryModule } from "../src/entry.ts";

const SELF = "file:///repo/packages/core/src/cli.ts";

/** A V8-style stack with the given frames after the `Error` header line. */
function stack(...frames: string[]): string {
  return ["Error", ...frames.map((f) => `    ${f}`)].join("\n");
}

Deno.test("callerModule returns the first frame outside selfUrl", () => {
  const s = stack(
    `at run (${SELF}:425:13)`,
    "at file:///repo/zuke.ts:396:7",
  );
  assertEquals(callerModule(s, SELF), "file:///repo/zuke.ts");
});

Deno.test("callerModule reads both parenthesised and bare frame forms", () => {
  // bare `at <url>` (top-level await frames have no function name)
  assertEquals(
    callerModule(stack(`at ${SELF}:1:1`, "at file:///repo/build.ts:9:5"), SELF),
    "file:///repo/build.ts",
  );
  // parenthesised `at name (<url>)`
  assertEquals(
    callerModule(
      stack(`at run (${SELF}:1:1)`, "at x (file:///repo/build.ts:9:5)"),
      SELF,
    ),
    "file:///repo/build.ts",
  );
});

Deno.test("callerModule skips every selfUrl frame", () => {
  const s = stack(
    `at run (${SELF}:425:13)`,
    `at inner (${SELF}:200:3)`,
    "at file:///repo/zuke.ts:1:1",
  );
  assertEquals(callerModule(s, SELF), "file:///repo/zuke.ts");
});

Deno.test("callerModule handles Windows file URLs with a drive colon", () => {
  const s = stack(`at run (${SELF}:1:1)`, "at file:///C:/proj/zuke.ts:3:9");
  assertEquals(callerModule(s, SELF), "file:///C:/proj/zuke.ts");
});

Deno.test("callerModule returns undefined when no other module is present", () => {
  assertEquals(callerModule(stack(`at run (${SELF}:1:1)`), SELF), undefined);
  assertEquals(callerModule("Error", SELF), undefined);
});

Deno.test("isEntryModule is true when the caller is the main module", () => {
  const s = stack(`at run (${SELF}:1:1)`, "at file:///repo/zuke.ts:5:1");
  assertEquals(isEntryModule(s, SELF, "file:///repo/zuke.ts"), true);
});

Deno.test("isEntryModule is false when the caller is some other module", () => {
  const s = stack(`at run (${SELF}:1:1)`, "at file:///repo/zuke.ts:5:1");
  assertEquals(isEntryModule(s, SELF, "file:///repo/test_main.ts"), false);
});

Deno.test("isEntryModule defaults to true when the caller is unknown", () => {
  // No identifiable caller frame — keep run()'s always-execute behaviour.
  assertEquals(isEntryModule("Error", SELF, "file:///repo/anything.ts"), true);
});
