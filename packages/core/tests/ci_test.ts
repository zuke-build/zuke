import { assertEquals, assertStringIncludes } from "./_assert.ts";
import {
  cicd,
  type CiPipeline,
  discoverCiFiles,
  generateCi,
  syncCiFiles,
} from "../src/ci.ts";
import { Build } from "../src/build.ts";
import { target } from "../src/target.ts";

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

Deno.test("github: permissions, concurrency, job if/timeout, and step env render", () => {
  const yaml = generateCi({
    name: "AI Review",
    triggers: { pullRequest: [] }, // every branch — no filter
    permissions: { contents: "read", "pull-requests": "write" },
    concurrency: { group: "ai-${{ github.ref }}", cancelInProgress: true },
    jobs: [{
      id: "review",
      if: "${{ github.event.pull_request.head.repo.fork == false }}",
      timeoutMinutes: 15,
      steps: [{
        name: "Review",
        run: "./zuke review",
        env: { OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}" },
      }],
    }],
  }, "github");
  // An empty pull_request branch list emits an unfiltered trigger.
  assertStringIncludes(yaml, "pull_request: {}");
  assertStringIncludes(yaml, "permissions:\n  contents: read");
  assertStringIncludes(yaml, "pull-requests: write");
  assertStringIncludes(yaml, "concurrency:\n  group:");
  assertStringIncludes(yaml, "cancel-in-progress: true");
  assertStringIncludes(yaml, 'if: "${{ github.event.pull_request');
  assertStringIncludes(yaml, "timeout-minutes: 15");
  assertStringIncludes(yaml, "env:\n          OPENAI_API_KEY:");
});

Deno.test("github: an empty push branch list is an unfiltered push trigger", () => {
  const yaml = generateCi({ triggers: { push: [] } }, "github");
  assertStringIncludes(yaml, "push: {}");
});

Deno.test("gitlab: a job timeout renders; if and step env are ignored", () => {
  const yaml = generateCi({
    jobs: [{
      id: "review",
      if: "should-be-ignored",
      timeoutMinutes: 15,
      steps: [{ run: "./zuke review", env: { K: "v" } }],
    }],
  }, "gitlab");
  assertStringIncludes(yaml, "timeout: 15 minutes");
  assertEquals(yaml.includes("should-be-ignored"), false);
});

Deno.test("azure: condition, timeout, and unfiltered pr branches render", () => {
  const yaml = generateCi({
    triggers: { pullRequest: [] },
    jobs: [{
      id: "review",
      if: "eq(1,1)",
      timeoutMinutes: 15,
      steps: [{ run: "x" }],
    }],
  }, "azure");
  assertStringIncludes(yaml, 'pr:\n  branches:\n    include:\n      - "*"');
  assertStringIncludes(yaml, 'condition: "eq(1,1)"'); // parens force quoting
  assertStringIncludes(yaml, "timeoutInMinutes: 15");
});

Deno.test("azure: a step's env block renders alongside its script", () => {
  const yaml = generateCi({
    jobs: [{
      id: "review",
      steps: [{ run: "./zuke review", env: { KEY: "$(KEY)" } }],
    }],
  }, "azure");
  // Azure secrets aren't exposed by default — the env block is what wires them.
  assertStringIncludes(yaml, "- script: ./zuke review");
  assertStringIncludes(yaml, "env:\n          KEY:");
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

Deno.test("explicit empty triggers render without an on/trigger block", () => {
  const bare: CiPipeline = {
    name: "CI",
    triggers: {},
    jobs: [{ id: "a", steps: [{ run: "x" }] }],
  };
  assertStringIncludes(generateCi(bare, "github"), `"on": {}`);
  assertEquals(generateCi(bare, "gitlab").includes("workflow:"), false);
  assertEquals(generateCi(bare, "azure").includes("trigger:"), false);
});

Deno.test("defaults: name, triggers and job id fill in", () => {
  // Only steps are given; everything else falls back to a meaningful default.
  const yaml = generateCi(
    { jobs: [{ steps: [{ run: "deno task ci" }] }] },
    "github",
  );
  assertStringIncludes(yaml, "name: CI"); // default name
  assertStringIncludes(yaml, `"on":`); // default triggers present
  assertStringIncludes(yaml, "push:\n    branches:\n      - main"); // default branch
  assertStringIncludes(yaml, "pull_request:");
  assertStringIncludes(yaml, "build:"); // default job id
});

Deno.test("defaults: a default job id flows through every provider", () => {
  const pipeline: CiPipeline = {
    triggers: {},
    jobs: [{ steps: [{ run: "x" }] }],
  };
  assertStringIncludes(generateCi(pipeline, "github"), "build:");
  assertStringIncludes(generateCi(pipeline, "gitlab"), "build:");
  assertStringIncludes(generateCi(pipeline, "azure"), "- job: build");
});

Deno.test("defaults: jobs and steps fall back to a single build step", () => {
  // An empty pipeline still produces a complete, runnable workflow.
  const yaml = generateCi({}, "github");
  assertStringIncludes(yaml, "name: CI");
  assertStringIncludes(yaml, "build:"); // default job id
  assertStringIncludes(yaml, "run: ./zuke"); // default step runs the build
});

Deno.test("defaults: the default job/step flow through every provider", () => {
  const empty: CiPipeline = { triggers: {} };
  assertStringIncludes(generateCi(empty, "github"), "run: ./zuke");
  assertStringIncludes(generateCi(empty, "gitlab"), "- ./zuke");
  assertStringIncludes(generateCi(empty, "azure"), "script: ./zuke");
});

Deno.test("defaults: a job may omit steps and get the default step", () => {
  const yaml = generateCi({ triggers: {}, jobs: [{ id: "verify" }] }, "github");
  assertStringIncludes(yaml, "verify:");
  assertStringIncludes(yaml, "run: ./zuke");
});

Deno.test("cicd: with only a provider declares the default workflow", () => {
  const file = cicd({ provider: "github" });
  assertEquals(file.path, ".github/workflows/ci.yml");
  assertStringIncludes(file.render(), "run: ./zuke");
});

Deno.test("cicd: the path follows the provider unless overridden", () => {
  const pipeline: CiPipeline = { jobs: [{ steps: [{ run: "x" }] }] };
  assertEquals(
    cicd({ provider: "github", pipeline }).path,
    ".github/workflows/ci.yml",
  );
  assertEquals(cicd({ provider: "gitlab", pipeline }).path, ".gitlab-ci.yml");
  assertEquals(
    cicd({ provider: "azure", pipeline }).path,
    "azure-pipelines.yml",
  );
  // An explicit path overrides the convention.
  assertEquals(
    cicd({ provider: "github", path: "custom.yml", pipeline }).path,
    "custom.yml",
  );
});

// --- Declarative CI files: cicd(), discovery, and on-disk sync ---

const filePipeline: CiPipeline = {
  name: "CI",
  triggers: { push: ["main"] },
  jobs: [{ id: "test", steps: [{ run: "deno task ci" }] }],
};

Deno.test("cicd: path and render reflect the spec", () => {
  const file = cicd({
    provider: "github",
    path: ".github/workflows/ci.yml",
    pipeline: filePipeline,
  });
  assertEquals(file.path, ".github/workflows/ci.yml");
  assertStringIncludes(file.render(), "name: CI");
});

Deno.test("discoverCiFiles collects every declared CI file", () => {
  class WithCi extends Build {
    gh = cicd({
      provider: "github",
      path: ".github/workflows/ci.yml",
      pipeline: filePipeline,
    });
    gl = cicd({
      provider: "gitlab",
      path: ".gitlab-ci.yml",
      pipeline: filePipeline,
    });
    build = target().executes(() => {});
  }
  const paths = discoverCiFiles(new WithCi()).map((f) => f.path).sort();
  assertEquals(paths, [".github/workflows/ci.yml", ".gitlab-ci.yml"]);
});

Deno.test("discoverCiFiles returns nothing for a build without CI", () => {
  class Bare extends Build {
    build = target().executes(() => {});
  }
  assertEquals(discoverCiFiles(new Bare()), []);
});

Deno.test("syncCiFiles writes a changed file, then leaves a current one", async () => {
  const store = new Map<string, string>();
  const file = cicd({
    provider: "github",
    path: "ci.yml",
    pipeline: filePipeline,
  });
  const opts = {
    read: (p: string) => Promise.resolve(store.get(p) ?? null),
    write: (p: string, c: string) => {
      store.set(p, c);
      return Promise.resolve();
    },
  };
  const first = await syncCiFiles([file], opts);
  assertEquals(first[0].status, "written");
  assertEquals(store.get("ci.yml"), file.render());
  const second = await syncCiFiles([file], opts);
  assertEquals(second[0].status, "unchanged");
});

Deno.test("syncCiFiles in check mode reports a stale file without writing", async () => {
  const file = cicd({
    provider: "github",
    path: "ci.yml",
    pipeline: filePipeline,
  });
  let wrote = false;
  const results = await syncCiFiles([file], {
    check: true,
    read: () => Promise.resolve("old content"),
    write: () => {
      wrote = true;
      return Promise.resolve();
    },
  });
  assertEquals(results[0].status, "stale");
  assertEquals(wrote, false);
});

Deno.test("syncCiFiles in check mode passes when content already matches", async () => {
  const file = cicd({
    provider: "github",
    path: "ci.yml",
    pipeline: filePipeline,
  });
  const results = await syncCiFiles([file], {
    check: true,
    read: () => Promise.resolve(file.render()),
  });
  assertEquals(results[0].status, "unchanged");
});

Deno.test("syncCiFiles tolerates a CRLF working copy (Windows checkout)", async () => {
  // Simulate a Windows checkout where git's autocrlf has converted LF→CRLF;
  // the rendered output is always LF, so a naive comparison would mismatch.
  const file = cicd({
    provider: "github",
    path: "ci.yml",
    pipeline: filePipeline,
  });
  const crlf = file.render().replace(/\n/g, "\r\n");
  const results = await syncCiFiles([file], {
    check: true,
    read: () => Promise.resolve(crlf),
  });
  assertEquals(results[0].status, "unchanged");
});

Deno.test("syncCiFiles uses the real filesystem by default", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/.github/workflows/ci.yml`;
    const file = cicd({ provider: "github", path, pipeline: filePipeline });
    const first = await syncCiFiles([file]); // creates parent dirs and writes
    assertEquals(first[0].status, "written");
    assertEquals(await Deno.readTextFile(path), file.render());
    const second = await syncCiFiles([file]);
    assertEquals(second[0].status, "unchanged");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
