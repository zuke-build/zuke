/**
 * Regression tests for the committed `codeql.yml` — the SAST lane.
 *
 * These assert the committed artifact rather than the declaration in
 * `build/workflows.ts`, because the artifact is what GitHub runs: the gate's
 * `generate-ci --check` already proves the two agree, so pinning the properties
 * here pins them in both places. Each property guards something that would
 * regress silently — dropping the `pull_request` trigger, say, would not break
 * any build, but every commit would stop carrying a code-scanning check and the
 * OpenSSF Scorecard SAST score would drift back to zero.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";

const WORKFLOW = ".github/workflows/codeql.yml";

Deno.test("codeql.yml analyzes every pull request and push to master", async () => {
  // Per-commit analysis is the point: the Scorecard SAST check counts the
  // commits that carry a code-scanning check run, so a schedule-only CodeQL
  // workflow would scan the code without ever crediting a commit.
  const text = await Deno.readTextFile(WORKFLOW);
  assertStringIncludes(text, "pull_request:");
  assertStringIncludes(text, "- master");
  assertStringIncludes(text, "schedule:");
});

Deno.test("codeql.yml grants the analyze job only what uploading needs", async () => {
  // `security-events: write` is what lets `analyze` upload the SARIF; contents
  // stays read-only and nothing else is granted, keeping the workflow within
  // the least-privilege posture the other workflows hold.
  const text = await Deno.readTextFile(WORKFLOW);
  assertStringIncludes(text, "security-events: write");
  assertEquals(text.includes("contents: write"), false);
  assertEquals(text.includes("id-token"), false);
});

Deno.test("codeql.yml covers the TypeScript sources and the workflows", async () => {
  // Two languages, one job: the `actions` pack audits the workflow YAML
  // itself, which for a repository that generates its workflows is the
  // artifact most worth scanning.
  const text = await Deno.readTextFile(WORKFLOW);
  assertStringIncludes(text, "javascript-typescript,actions");
});

Deno.test("codeql.yml pins both codeql-action halves to one SHA", async () => {
  // init and analyze ship as one release, so their pins must move together —
  // and each `uses:` must be a full SHA, like every other generated workflow.
  const text = await Deno.readTextFile(WORKFLOW);
  const uses = text.split("\n")
    .filter((line) => /^\s*(?:-\s+)?uses:\s*github\/codeql-action\//.test(line))
    .map((line) => {
      const match = /@([0-9a-f]{40})\s*#/.exec(line);
      return match === null ? line.trim() : match[1];
    });
  assertEquals(uses.length, 2, "expected exactly init and analyze");
  assertEquals(
    uses[0],
    uses[1],
    "init and analyze pin different SHAs — bump them together",
  );
  assertEquals(
    /^[0-9a-f]{40}$/.test(uses[0]),
    true,
    `not a full SHA: ${uses[0]}`,
  );
});
