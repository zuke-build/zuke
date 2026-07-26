/**
 * Unit tests for the PR-body linter (`build/pr_body_lint.ts`): fenced code
 * blocks and code-shaped paren-bearing lines are flagged; ordinary prose
 * parentheses are not.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { lintPrBody } from "../build/pr_body_lint.ts";

Deno.test("a clean prose body has no findings", () => {
  assertEquals(
    lintPrBody(
      "This fixes the retry logic so a timed-out request is retried once.",
    ),
    [],
  );
});

Deno.test("ordinary prose parentheses are not flagged", () => {
  assertEquals(lintPrBody("Fixes the race from before (see #241)."), []);
});

Deno.test("a fenced code block is flagged", () => {
  const body = [
    "Summary of the change.",
    "",
    "```ts",
    'const x = () => "y";',
    "```",
  ].join("\n");
  const findings = lintPrBody(body);
  assertEquals(findings.length, 1);
  assertEquals(findings[0].includes("line 3"), true);
  assertEquals(findings[0].includes("fenced code block"), true);
});

Deno.test("an unterminated fenced code block is still flagged once", () => {
  const body = ["Summary.", "", "```ts", "const x = 1;"].join("\n");
  const findings = lintPrBody(body);
  assertEquals(findings.length, 1);
  assertEquals(findings[0].includes("unterminated"), true);
});

Deno.test("lines inside a fence are not double-flagged individually", () => {
  const body = [
    "```ts",
    "map((x) => x);",
    "another((y) => y);",
    "```",
  ].join("\n");
  assertEquals(lintPrBody(body).length, 1);
});

Deno.test("an arrow-function line outside a fence is flagged", () => {
  const findings = lintPrBody(
    "Changed items.map((x) => x.id) to use a for loop.",
  );
  assertEquals(findings.length, 1);
  assertEquals(findings[0].includes("line 1"), true);
});

Deno.test("a bare call statement line outside a fence is flagged", () => {
  const findings = lintPrBody("Run cleanup();\nto reset state.");
  assertEquals(findings.length, 1);
  assertEquals(findings[0].includes("line 1"), true);
});

Deno.test("multiple fences and prose paragraphs each produce their own findings", () => {
  const body = [
    "First change.",
    "```ts",
    "a();",
    "```",
    "Second change (unrelated).",
    "```js",
    "b();",
    "```",
  ].join("\n");
  const findings = lintPrBody(body);
  assertEquals(findings.length, 2);
});
