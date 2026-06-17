import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { type CiPipeline, generateCi } from "../src/ci.ts";

/** A small pipeline exercised across providers. */
const pipeline: CiPipeline = {
  name: "CI",
  triggers: { push: ["main"], pullRequest: ["main"], manual: true },
  jobs: [{
    id: "test",
    name: "Test suite",
    needs: ["lint"],
    matrix: { os: ["ubuntu-latest", "macos-latest"] },
    env: { CI: "true" },
    steps: [
      { uses: "denoland/setup-deno@v2", with: { "deno-version": "v2.x" } },
      { name: "Run tests", run: "deno task ci" },
    ],
  }, {
    id: "lint",
    steps: [{ run: "deno lint" }],
  }],
};

Deno.test("github: triggers, matrix-driven runs-on, needs, uses and run steps", () => {
  const yaml = generateCi(pipeline, "github");
  assertStringIncludes(yaml, "name: CI");
  // `on` is quoted so YAML doesn't read it as a boolean.
  assertStringIncludes(yaml, `"on":`);
  assertStringIncludes(yaml, "push:\n    branches:\n      - main");
  assertStringIncludes(yaml, "pull_request:");
  assertStringIncludes(yaml, "workflow_dispatch: {}");
  // A job with an `os` matrix runs on the matrix value.
  assertStringIncludes(yaml, `runs-on: "\${{ matrix.os }}"`);
  assertStringIncludes(yaml, "strategy:\n      matrix:\n        os:");
  assertStringIncludes(yaml, "needs:\n      - lint");
  assertStringIncludes(yaml, "uses: denoland/setup-deno@v2");
  assertStringIncludes(yaml, "deno-version: v2.x");
  assertStringIncludes(yaml, "run: deno task ci");
});

Deno.test("github: a job without an os matrix uses runsOn or the default", () => {
  const yaml = generateCi({
    name: "CI",
    jobs: [
      { id: "a", runsOn: "windows-latest", steps: [{ run: "echo a" }] },
      { id: "b", steps: [{ run: "echo b" }] },
    ],
  }, "github");
  assertStringIncludes(yaml, "runs-on: windows-latest");
  assertStringIncludes(yaml, "runs-on: ubuntu-latest");
});

Deno.test("gitlab: workflow rules, stages, image, parallel matrix, script", () => {
  const yaml = generateCi(pipeline, "gitlab");
  assertStringIncludes(yaml, "workflow:\n  rules:");
  // The `if:` expressions contain `$` and quotes, so YAML double-quotes them;
  // assert on the distinctive inner tokens rather than the escaped string.
  assertStringIncludes(yaml, "CI_COMMIT_BRANCH");
  assertStringIncludes(yaml, "merge_request_event");
  assertStringIncludes(yaml, "CI_PIPELINE_SOURCE ==");
  assertStringIncludes(yaml, "stages:\n  - build");
  assertStringIncludes(yaml, "test:\n  stage: build");
  // Only `run` steps become script lines; the `uses` step is dropped.
  assertStringIncludes(yaml, "script:\n    - deno task ci");
  assertEquals(yaml.includes("setup-deno"), false);
  assertStringIncludes(yaml, "parallel:\n    matrix:\n      - os:");
});

Deno.test("gitlab: a job's runsOn becomes the image", () => {
  const yaml = generateCi({
    name: "CI",
    jobs: [{ id: "a", runsOn: "denoland/deno:latest", steps: [{ run: "x" }] }],
  }, "gitlab");
  // A colon makes the image value a quoted scalar; assert the value substring.
  assertStringIncludes(yaml, "denoland/deno:latest");
});

Deno.test("azure: trigger/pr branches, pool, dependsOn, matrix product, steps", () => {
  const yaml = generateCi(pipeline, "azure");
  assertStringIncludes(
    yaml,
    "trigger:\n  branches:\n    include:\n      - main",
  );
  assertStringIncludes(yaml, "pr:\n  branches:\n    include:\n      - main");
  assertStringIncludes(yaml, "- job: test");
  assertStringIncludes(yaml, "displayName: Test suite");
  assertStringIncludes(yaml, "pool:\n      vmImage: ubuntu-latest");
  assertStringIncludes(yaml, "dependsOn:\n      - lint");
  // Single-dimension matrix yields one named config per value.
  assertStringIncludes(
    yaml,
    "matrix:\n        ubuntu-latest:\n          os: ubuntu-latest",
  );
  assertStringIncludes(yaml, "script: deno task ci");
  assertEquals(yaml.includes("setup-deno"), false);
});

Deno.test("azure: a multi-dimension matrix is expanded to the cartesian product", () => {
  const yaml = generateCi({
    name: "CI",
    jobs: [{
      id: "test",
      matrix: { os: ["linux", "mac"], deno: ["1.0", "2.0"] },
      steps: [{ run: "x" }],
    }],
  }, "azure");
  // 2 x 2 = 4 named configurations, labelled by their joined values.
  assertStringIncludes(yaml, "linux_1.0:");
  assertStringIncludes(yaml, "linux_2.0:");
  assertStringIncludes(yaml, "mac_1.0:");
  assertStringIncludes(yaml, "mac_2.0:");
  // Numeric-looking matrix values are quoted to stay strings.
  assertStringIncludes(yaml, `deno: "2.0"`);
});

Deno.test("azure: a manual-only pipeline disables the CI trigger", () => {
  const yaml = generateCi({
    name: "CI",
    triggers: { manual: true },
    jobs: [{ id: "a", steps: [{ run: "x" }] }],
  }, "azure");
  assertStringIncludes(yaml, "trigger: none");
});

Deno.test("a pipeline with no triggers renders without an on/trigger block", () => {
  const bare: CiPipeline = {
    name: "CI",
    jobs: [{ id: "a", steps: [{ run: "x" }] }],
  };
  assertStringIncludes(generateCi(bare, "github"), `"on": {}`);
  assertEquals(generateCi(bare, "gitlab").includes("workflow:"), false);
  assertEquals(generateCi(bare, "azure").includes("trigger:"), false);
});
