/**
 * Unit tests for the PR-body linter (`build/pr_body_lint.ts`): fenced code
 * blocks and code-shaped paren-bearing lines are flagged; ordinary prose
 * parentheses are not. Also guards the workflow trigger that makes the gate
 * actually run when a PR description changes.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { lintPrBody } from "../build/pr_body_lint.ts";

const CI_WORKFLOW = await Deno.readTextFile(".github/workflows/ci.yml");

/** The `on.pull_request` trigger block of the CI workflow, as source text. */
function pullRequestTrigger(workflow: string): string {
  const start = workflow.indexOf("\n  pull_request:");
  if (start === -1) {
    throw new Error(
      "could not find the `pull_request` trigger in .github/workflows/ci.yml",
    );
  }
  const end = workflow.indexOf("\npermissions:", start);
  if (end === -1) {
    throw new Error(
      "could not find the end of the `on:` block in .github/workflows/ci.yml",
    );
  }
  return workflow.slice(start, end);
}

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

Deno.test("a member-call fragment outside a fence is flagged", () => {
  // The exact shape that reached a commit body in the wrapper-catalogue work:
  // no arrow function and no bare `();`, so only the member-call rule catches
  // it, and release-please's parser still chokes on its parentheses.
  const findings = lintPrBody(
    'Show the anti-pattern CmdTasks.exec("docker", args) beside the typed ' +
      "replacement DockerTasks.build(settings).",
  );
  assertEquals(findings.length, 1);
  assertEquals(findings[0].includes("line 1"), true);
});

Deno.test("a filename with a following parenthetical is not flagged", () => {
  assertEquals(
    lintPrBody(
      "Links the new guide from docs/README.md (both documentation indexes).",
    ),
    [],
  );
});

Deno.test("the CI workflow re-runs on an edited PR description", () => {
  // Without an explicit `types:`, `pull_request` fires only on opened,
  // synchronize and reopened — so editing the description after the last push
  // would leave the already-green status for the unchanged head SHA in place
  // and the new body would never be linted before the squash-merge.
  const trigger = pullRequestTrigger(CI_WORKFLOW);
  assertStringIncludes(trigger, "types:");
  assertStringIncludes(trigger, "edited");
  for (const type of ["opened", "synchronize", "reopened"]) {
    assertStringIncludes(trigger, type);
  }
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
