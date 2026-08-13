// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "./_assert.ts";
import {
  cicd,
  CiFile,
  type CiPipeline,
  discoverCiFiles,
  fanOutPipeline,
  generateCi,
  syncCiFiles,
} from "../src/ci.ts";
import { Build, discoverTargets } from "../src/build.ts";
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

Deno.test("bitbucket: a PR pipeline maps to pull-requests with a step list", () => {
  const yaml = generateCi({
    triggers: { pullRequest: [] }, // every branch → "**"
    jobs: [{
      id: "review",
      name: "AI review",
      runsOn: "denoland/deno:latest",
      timeoutMinutes: 15,
      steps: [{ run: "./zuke review" }],
    }],
  }, "bitbucket");
  assertStringIncludes(yaml, "pipelines:\n  pull-requests:");
  assertStringIncludes(yaml, '"**":'); // unfiltered branch pattern
  assertStringIncludes(yaml, "- step:");
  assertStringIncludes(yaml, "name: AI review");
  assertStringIncludes(yaml, 'image: "denoland/deno:latest"');
  assertStringIncludes(yaml, "max-time: 15");
  assertStringIncludes(yaml, "script:\n            - ./zuke review");
});

Deno.test("bitbucket: push triggers map to branches, empty push to default", () => {
  const named = generateCi({
    triggers: { push: ["main"] },
    jobs: [{ id: "a", steps: [{ run: "x" }] }],
  }, "bitbucket");
  assertStringIncludes(named, "branches:\n    main:");

  const def = generateCi({
    triggers: { push: [] }, // every branch → default section
    jobs: [{ id: "a", steps: [{ run: "x" }] }],
  }, "bitbucket");
  assertStringIncludes(def, "pipelines:\n  default:");
});

Deno.test("bitbucket: a manual-only pipeline becomes a custom trigger", () => {
  const yaml = generateCi({
    triggers: { manual: true },
    jobs: [{ id: "a", steps: [{ run: "x" }] }],
  }, "bitbucket");
  assertStringIncludes(yaml, "custom:\n    ai-review:");
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
  assertEquals(
    cicd({ provider: "bitbucket", pipeline }).path,
    "bitbucket-pipelines.yml",
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

/** A small build whose targets exercise the fan-out. */
class FanBuild extends Build {
  lint = target().description("Lint").executes(() => {});
  test = target().dependsOn(this.lint).executes(() => {});
  build = target().dependsOn(this.lint).executes(() => {});
  hidden = target().unlisted().executes(() => {});
  empty = target().description("no body"); // not runnable
}

Deno.test("fanOutPipeline makes one job per runnable target, wired by dependencies", () => {
  const targets = discoverTargets(new FanBuild());
  const pipeline = fanOutPipeline(targets);
  const jobs = pipeline.jobs ?? [];
  const ids = jobs.map((j) => j.id);
  // lint/test/build only: `hidden` is unlisted and `empty` has no body.
  assertEquals(ids, ["lint", "test", "build"]);

  const test = jobs.find((j) => j.id === "test");
  assertEquals(test?.needs, ["lint"]); // mirrors dependsOn
  assertEquals(test?.steps?.at(-1)?.run, "./zuke test"); // default launcher command
  assertEquals(test?.steps?.[0]?.uses, "actions/checkout@v4"); // default setup

  const lint = jobs.find((j) => j.id === "lint");
  assertEquals(lint?.needs, undefined); // no dependencies → no needs
  assertEquals(lint?.name, "Lint"); // description becomes the job name
});

Deno.test("fanOutPipeline honours includeUnlisted and drops needs to omitted jobs", () => {
  const targets = discoverTargets(new FanBuild());
  const pipeline = fanOutPipeline(targets, {}, { includeUnlisted: true });
  const ids = (pipeline.jobs ?? []).map((j) => j.id);
  assertEquals(ids.includes("hidden"), true);
});

Deno.test("fanOutPipeline drops needs edges to excluded targets", () => {
  class B extends Build {
    hiddenDep = target().unlisted().executes(() => {});
    app = target().dependsOn(this.hiddenDep).executes(() => {});
  }
  const pipeline = fanOutPipeline(discoverTargets(new B()));
  const app = (pipeline.jobs ?? []).find((j) => j.id === "app");
  assertEquals(app?.needs, undefined); // the only dep was excluded
});

Deno.test("fanOutPipeline applies command, runsOn, env, and setup overrides", () => {
  const targets = discoverTargets(new FanBuild());
  const pipeline = fanOutPipeline(targets, {}, {
    command: (t) => `make ${t}`,
    runsOn: "self-hosted",
    env: { KEY: "v" },
    setupSteps: [{ name: "Prep", run: "echo prep" }],
  });
  const lint = (pipeline.jobs ?? []).find((j) => j.id === "lint");
  assertEquals(lint?.runsOn, "self-hosted");
  assertEquals(lint?.env, { KEY: "v" });
  assertEquals(lint?.steps?.[0]?.run, "echo prep");
  assertEquals(lint?.steps?.at(-1)?.run, "make lint");
});

Deno.test("fanOutPipeline carries base pipeline fields and ignores base jobs", () => {
  const targets = discoverTargets(new FanBuild());
  const pipeline = fanOutPipeline(targets, {
    name: "My CI",
    triggers: { push: ["release"] },
    permissions: { contents: "read" },
    concurrency: { group: "g", cancelInProgress: true },
    jobs: [{ id: "ignored", steps: [{ run: "nope" }] }],
  });
  assertEquals(pipeline.name, "My CI");
  assertEquals(pipeline.triggers?.push, ["release"]);
  assertEquals(pipeline.permissions, { contents: "read" });
  assertEquals(pipeline.concurrency?.group, "g");
  assertEquals((pipeline.jobs ?? []).some((j) => j.id === "ignored"), false);
});

Deno.test("fanOutPipeline sanitises dotted component target names into job ids", () => {
  const release = { publish: target().dependsOn().executes(() => {}) };
  class B extends Build {
    release = release;
    deploy = target().dependsOn(release.publish).executes(() => {});
  }
  const pipeline = fanOutPipeline(discoverTargets(new B()));
  const ids = (pipeline.jobs ?? []).map((j) => j.id);
  assertEquals(ids.includes("release-publish"), true); // dot → dash
  const deploy = (pipeline.jobs ?? []).find((j) => j.id === "deploy");
  assertEquals(deploy?.needs, ["release-publish"]);
});

Deno.test("cicd fanOut expands into a per-target workflow via discoverCiFiles", () => {
  class WithFanOut extends Build {
    lint = target().executes(() => {});
    test = target().dependsOn(this.lint).executes(() => {});
    ci = cicd({
      provider: "github",
      fanOut: true,
      pipeline: { name: "Fanned" },
    });
  }
  const files = discoverCiFiles(new WithFanOut());
  assertEquals(files.length, 1);
  const yaml = files[0].render();
  assertStringIncludes(yaml, "name: Fanned");
  assertStringIncludes(yaml, "run: ./zuke lint");
  assertStringIncludes(yaml, "run: ./zuke test");
  assertStringIncludes(yaml, "needs:");
});

Deno.test("a non-fan-out cicd file is unaffected by discovery resolution", () => {
  class Plain extends Build {
    build = target().executes(() => {});
    ci = cicd({ provider: "github", pipeline: { name: "Plain" } });
  }
  const yaml = discoverCiFiles(new Plain())[0].render();
  assertStringIncludes(yaml, "name: Plain");
});

Deno.test("CiFile.pipelineFor returns the base pipeline when not fanning out", () => {
  const file = new CiFile({ provider: "github", pipeline: { name: "Base" } });
  assertEquals(file.pipelineFor(new Map()).name, "Base");
});

Deno.test("cicd accepts fan-out options directly", () => {
  class B extends Build {
    lint = target().executes(() => {});
    ci = cicd({ provider: "github", fanOut: { runsOn: "self-hosted" } });
  }
  const yaml = discoverCiFiles(new B())[0].render();
  assertStringIncludes(yaml, "runs-on: self-hosted");
});

// --- timezone-aware schedules (M8) ---

Deno.test("github: a UTC schedule renders on.schedule with no guard job", () => {
  const yaml = generateCi(
    { triggers: { schedule: [{ cron: "0 6 * * *" }] } },
    "github",
  );
  assertStringIncludes(yaml, 'schedule:\n    - cron: "0 6 * * *"');
  assertEquals(yaml.includes("zuke-schedule-guard"), false);
});

Deno.test("github: a DST schedule emits dual crons, a guard job, and gates jobs", () => {
  const yaml = generateCi(
    {
      triggers: { schedule: [{ cron: "30 9 * * *", tz: "Europe/Sofia" }] },
      jobs: [{ id: "test", steps: [{ run: "deno task ci" }] }],
    },
    "github",
  );
  // Both offsets are registered as UTC crons.
  assertStringIncludes(yaml, `- cron: "30 7 * * *"`);
  assertStringIncludes(yaml, `- cron: "30 6 * * *"`);
  // A guard job with a run output, and the real job wired to it.
  assertStringIncludes(yaml, "zuke-schedule-guard:");
  assertStringIncludes(yaml, 'run: "${{ steps.check.outputs.run }}"');
  assertStringIncludes(yaml, "needs:\n      - zuke-schedule-guard");
  assertStringIncludes(
    yaml,
    `if: "\${{ needs.zuke-schedule-guard.outputs.run == 'true' }}"`,
  );
  // The guard shell reads the zone's wall-clock.
  assertStringIncludes(yaml, "TZ='Europe/Sofia' date");
});

Deno.test("github: the guard ANDs onto an existing job condition", () => {
  const yaml = generateCi(
    {
      triggers: { schedule: [{ cron: "30 9 * * *", tz: "Europe/Sofia" }] },
      jobs: [{
        id: "test",
        if: "${{ github.actor != 'bot' }}",
        steps: [{ run: "x" }],
      }],
    },
    "github",
  );
  assertStringIncludes(
    yaml,
    "(github.actor != 'bot') && (needs.zuke-schedule-guard.outputs.run == 'true')",
  );
});

Deno.test("azure: a UTC/fixed schedule renders native schedules; a DST zone errors", () => {
  const yaml = generateCi(
    {
      triggers: {
        push: ["main"],
        schedule: [{ cron: "0 6 * * *", tz: "Etc/GMT-2" }],
      },
    },
    "azure",
  );
  assertStringIncludes(yaml, "schedules:");
  assertStringIncludes(yaml, `- cron: "0 4 * * *"`);
  assertStringIncludes(yaml, "always: true");

  let threw = "";
  try {
    generateCi(
      { triggers: { schedule: [{ cron: "30 9 * * *", tz: "Europe/Sofia" }] } },
      "azure",
    );
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(threw, "GitHub-only");
});

Deno.test("github: a job colliding with the guard id is a friendly error", () => {
  let threw = "";
  try {
    generateCi(
      {
        triggers: { schedule: [{ cron: "30 9 * * *", tz: "Europe/Sofia" }] },
        jobs: [{ id: "zuke-schedule-guard", steps: [{ run: "x" }] }],
      },
      "github",
    );
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(threw, "collides with the generated");
});

Deno.test("gitlab and bitbucket ignore schedules (configured in the provider UI)", () => {
  const triggers = { schedule: [{ cron: "30 9 * * *", tz: "Europe/Sofia" }] };
  assertEquals(generateCi({ triggers }, "gitlab").includes("cron"), false);
  assertEquals(generateCi({ triggers }, "bitbucket").includes("cron"), false);
});

Deno.test("github: harden and checkout are emitted before a job's own steps", () => {
  const yaml = generateCi({
    harden: {
      action: "step-security/harden-runner@abc123",
      egress: "block",
      allowedEndpoints: ["jsr.io:443", "deno.land:443"],
    },
    checkout: { action: "actions/checkout@def456" },
    jobs: [{ id: "gate", steps: [{ name: "Gate", run: "./zuke ci" }] }],
  }, "github");

  // The order is the whole point: hardening constrains everything after it, so
  // it cannot come after the checkout that fetches the code it constrains.
  const hardenAt = yaml.indexOf("harden-runner@abc123");
  const checkoutAt = yaml.indexOf("checkout@def456");
  const buildAt = yaml.indexOf("./zuke ci");
  assertEquals(hardenAt < checkoutAt && checkoutAt < buildAt, true);
  assertStringIncludes(yaml, "egress-policy: block");
  // Space-separated on one line — exactly what a folded scalar collapses to,
  // which is the form already known to enforce correctly. The action documents
  // no delimiter, so the gate's egress control must not depend on a guess.
  assertStringIncludes(yaml, 'allowed-endpoints: "jsr.io:443 deno.land:443"');
  assertStringIncludes(yaml, 'persist-credentials: "false"');
});

Deno.test("github: an audit policy is the default and emits no allowlist", () => {
  const yaml = generateCi({
    harden: { action: "step-security/harden-runner@abc123" },
    jobs: [{ steps: [{ run: "x" }] }],
  }, "github");
  assertStringIncludes(yaml, "egress-policy: audit");
  assertEquals(yaml.includes("allowed-endpoints"), false);
});

Deno.test("github: a job overrides or opts out of the pipeline prelude", () => {
  const yaml = generateCi({
    harden: { action: "harden@pipeline" },
    checkout: { action: "checkout@pipeline" },
    jobs: [
      // Opts out of hardening entirely, and takes a deeper checkout.
      {
        id: "bare",
        harden: false,
        checkout: { action: "checkout@job", fetchDepth: 0 },
        steps: [{ run: "a" }],
      },
      // Inherits both from the pipeline.
      { id: "inherits", steps: [{ run: "b" }] },
    ],
  }, "github");

  const bare = yaml.slice(yaml.indexOf("bare:"), yaml.indexOf("inherits:"));
  assertEquals(bare.includes("harden@"), false);
  assertStringIncludes(bare, "checkout@job");
  assertStringIncludes(bare, 'fetch-depth: "0"');

  const inherits = yaml.slice(yaml.indexOf("inherits:"));
  assertStringIncludes(inherits, "harden@pipeline");
  assertStringIncludes(inherits, "checkout@pipeline");
});

Deno.test("github: per-job permissions isolate what each token can do", () => {
  const yaml = generateCi({
    permissions: { contents: "read" },
    jobs: [
      {
        id: "release",
        permissions: { contents: "write", "pull-requests": "write" },
        steps: [{ run: "a" }],
      },
      {
        id: "publish",
        permissions: { "id-token": "write" },
        steps: [{ run: "b" }],
      },
    ],
  }, "github");
  const release = yaml.slice(
    yaml.indexOf("release:"),
    yaml.indexOf("publish:"),
  );
  assertStringIncludes(release, "pull-requests: write");
  assertEquals(release.includes("id-token"), false);
  assertStringIncludes(yaml.slice(yaml.indexOf("publish:")), "id-token: write");
});

Deno.test("github: a step carries id, if, shell, and continue-on-error", () => {
  const yaml = generateCi({
    jobs: [{
      steps: [
        { name: "Mint", id: "token", run: "./zuke mint" },
        {
          name: "Windows only",
          if: "runner.os == 'Windows'",
          shell: "pwsh",
          run: "./zuke.ps1 test",
        },
        {
          name: "Always",
          if: "always()",
          run: "./zuke report",
          continueOnError: true,
        },
      ],
    }],
  }, "github");
  assertStringIncludes(yaml, "id: token");
  assertStringIncludes(yaml, `if: "runner.os == 'Windows'"`);
  assertStringIncludes(yaml, "shell: pwsh");
  assertStringIncludes(yaml, `if: "always()"`);
  assertStringIncludes(yaml, "continue-on-error: true");
});

Deno.test("github: failFast is emitted only when declared", () => {
  const kept = generateCi({
    jobs: [{
      matrix: { os: ["macos-latest"] },
      failFast: false,
      steps: [{ run: "x" }],
    }],
  }, "github");
  assertStringIncludes(kept, "fail-fast: false");
  const untouched = generateCi({
    jobs: [{ matrix: { os: ["macos-latest"] }, steps: [{ run: "x" }] }],
  }, "github");
  assertEquals(untouched.includes("fail-fast"), false);
});

Deno.test("github: pull-request types and branch protection triggers render", () => {
  const yaml = generateCi({
    triggers: {
      pullRequest: [],
      pullRequestTypes: ["opened", "synchronize", "reopened", "edited"],
      branchProtectionRule: true,
    },
    jobs: [{ steps: [{ run: "x" }] }],
  }, "github");
  assertStringIncludes(yaml, "types:");
  assertStringIncludes(yaml, "- edited");
  assertStringIncludes(yaml, "branch_protection_rule: {}");
});

Deno.test("invokes: one job per target, wired from the build graph", () => {
  // The point of the feature: naming targets is the whole declaration. Ids,
  // display names, commands, and needs edges all come from the graph.
  class B extends Build {
    lint = target().description("Lint it").executes(() => {});
    build = target().description("Build it").dependsOn(this.lint).executes(
      () => {},
    );
    wf = cicd({
      provider: "github",
      pipeline: { name: "CI" },
      invokes: [this.lint, this.build],
    });
  }
  const b = new B();
  const pipeline = b.wf.pipelineFor(discoverTargets(b));

  assertEquals(pipeline.jobs?.length, 2);
  assertEquals(pipeline.jobs?.[0].id, "lint");
  assertEquals(pipeline.jobs?.[0].name, "Lint it");
  assertEquals(pipeline.jobs?.[0].steps?.[0].run, "./zuke lint");
  assertEquals(pipeline.jobs?.[0].needs, undefined);
  // The edge mirrors dependsOn — nothing declared it.
  assertEquals(pipeline.jobs?.[1].id, "build");
  assertEquals(pipeline.jobs?.[1].needs, ["lint"]);
});

Deno.test("invokes: a dependency that is not itself a job is not an edge", () => {
  // `./zuke release` runs its own dependencies in-process, exactly as it does
  // locally — so an uninvoked dependency must not become a `needs:` edge that
  // waits for a job nobody generated.
  class B extends Build {
    prep = target().executes(() => {});
    ship = target().dependsOn(this.prep).executes(() => {});
    wf = cicd({ provider: "github", invokes: [this.ship] });
  }
  const b = new B();
  const pipeline = b.wf.pipelineFor(discoverTargets(b));
  assertEquals(pipeline.jobs?.length, 1);
  assertEquals(pipeline.jobs?.[0].needs, undefined);
});

Deno.test("invokes: `after` orders jobs the build graph leaves independent", () => {
  // Publishing after a release is a property of the pipeline, not a build
  // dependency — the targets stay independently runnable.
  class B extends Build {
    release = target().executes(() => {});
    publish = target().executes(() => {});
    wf = cicd({
      provider: "github",
      invokes: [this.release, { target: this.publish, after: [this.release] }],
    });
  }
  const b = new B();
  const pipeline = b.wf.pipelineFor(discoverTargets(b));
  assertEquals(pipeline.jobs?.[1].needs, ["release"]);
  // The build graph is untouched: `publish` still has no dependency.
  assertEquals(b.publish.dependsOn_.length, 0);
});

Deno.test("invokes: overrides cover what the runner decides, not the work", () => {
  class B extends Build {
    test = target().description("Run tests").executes(() => {});
    wf = cicd({
      provider: "github",
      invokes: [{
        target: this.test,
        name: "Tests (${{ matrix.os }})",
        matrix: { os: ["macos-latest", "windows-latest"] },
        failFast: false,
        permissions: { contents: "read" },
        timeoutMinutes: 20,
        env: { TOKEN: "${{ secrets.TOKEN }}" },
      }],
    });
  }
  const b = new B();
  const job = b.wf.pipelineFor(discoverTargets(b)).jobs?.[0];
  assertEquals(job?.name, "Tests (${{ matrix.os }})");
  assertEquals(job?.matrix, { os: ["macos-latest", "windows-latest"] });
  assertEquals(job?.failFast, false);
  assertEquals(job?.timeoutMinutes, 20);
  // The secret is mapped onto the target's own step, not the job.
  assertEquals(job?.steps?.[0].env, { TOKEN: "${{ secrets.TOKEN }}" });
});

Deno.test("invokes: before and then wrap the derived step", () => {
  class B extends Build {
    upload = target().executes(() => {});
    wf = cicd({
      provider: "github",
      invokes: [{
        target: this.upload,
        before: [{ name: "Produce it", uses: "acme/produce@sha" }],
        then: [{ name: "Announce", run: "echo done" }],
      }],
    });
  }
  const b = new B();
  const steps = b.wf.pipelineFor(discoverTargets(b)).jobs?.[0].steps;
  assertEquals(steps?.length, 3);
  assertEquals(steps?.[0].uses, "acme/produce@sha");
  assertEquals(steps?.[1].run, "./zuke upload");
  assertEquals(steps?.[2].run, "echo done");
});

Deno.test("invokes: a target that is not a build field is a friendly error", () => {
  // A stray builder has no name, so there is nothing to run — say so rather
  // than emitting `./zuke undefined`.
  class B extends Build {
    real = target().executes(() => {});
    wf = cicd({ provider: "github", invokes: [target().executes(() => {})] });
  }
  const b = new B();
  const targets = discoverTargets(b);
  let threw = "";
  try {
    b.wf.pipelineFor(targets);
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(threw, "not a field on this build");
});

Deno.test("invokes and fanOut are mutually exclusive", () => {
  class B extends Build {
    a = target().executes(() => {});
  }
  const b = new B();
  let threw = "";
  try {
    cicd({ provider: "github", invokes: [b.a], fanOut: true });
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(threw, "not both");
});

Deno.test("invokes: discoverCiFiles resolves the jobs, so render() sees them", () => {
  // The declaration holds target references whose names are assigned after
  // construction, so resolution has to happen at discovery.
  class B extends Build {
    gate = target().description("The gate").executes(() => {});
    wf = cicd({ provider: "github", invokes: [this.gate] });
  }
  const [file] = discoverCiFiles(new B());
  assertStringIncludes(file.render(), "run: ./zuke gate");
  assertStringIncludes(file.render(), "name: The gate");
});

Deno.test("the prelude is one action, resolved through the pins hook", () => {
  // Hardening, checkout and Deno setup are one prelude, not three decisions,
  // so they render as the one action that performs them. The resolver is asked
  // for it by name like any other, which is what lets a repository pin it.
  class B extends Build {
    gate = target().executes(() => {});
    wf = cicd({
      pins: (action) => `${action}@${"a".repeat(40)}`,
      invokes: [this.gate],
    });
  }
  const [file] = discoverCiFiles(new B());
  const yaml = file.render();
  assertStringIncludes(yaml, `zuke-build/zuke@${"a".repeat(40)}`);
  // The steps it replaces must be gone, not merely joined by a third.
  assertEquals(yaml.includes("step-security/harden-runner"), false);
  assertEquals(yaml.includes("actions/checkout"), false);
  assertStringIncludes(yaml, "egress-policy: audit");
});

Deno.test("pins: a job adjusts the policy without naming the action again", () => {
  class B extends Build {
    gate = target().executes(() => {});
    wf = cicd({
      pins: (action) => `${action}@${"b".repeat(40)}`,
      invokes: [{
        target: this.gate,
        harden: { egress: "block", allowedEndpoints: ["jsr.io:443"] },
      }],
    });
  }
  const [file] = discoverCiFiles(new B());
  const yaml = file.render();
  // The `harden` option is unchanged as the authoring surface; what changed is
  // that it configures the prelude action rather than a step of its own.
  assertStringIncludes(yaml, `zuke-build/zuke@${"b".repeat(40)}`);
  assertStringIncludes(yaml, "egress-policy: block");
  assertStringIncludes(yaml, 'allowed-endpoints: "jsr.io:443"');
});

Deno.test("pins: a missing pin is a friendly error, never an unpinned use", () => {
  // Emitting `uses:` with no ref would produce a floating reference that
  // supply-chain scanners reject, so this must fail rather than degrade.
  //
  // Only reachable with the prelude action turned off: with it on, an
  // unpinned `harden: {}` is rendered by an action that carries its own pin,
  // which is the point of it being the default.
  let threw = "";
  try {
    generateCi({
      bootstrap: false,
      harden: {},
      jobs: [{ steps: [{ run: "x" }] }],
    }, "github");
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(threw, "needs a pinned action");

  // And with the prelude on, the same declaration is pinned rather than fatal.
  const yaml = generateCi({
    harden: {},
    jobs: [{ steps: [{ run: "x" }] }],
  }, "github");
  assertEquals(/uses: zuke-build\/zuke@[0-9a-f]{40}/.test(yaml), true);
});

Deno.test("the workflow path comes from the field it is declared on", () => {
  class B extends Build {
    gate = target().executes(() => {});
    // `Workflow` is noise once the file is a workflow; camelCase reads better
    // kebab-cased in a filename.
    releaseWorkflow = cicd({ invokes: [this.gate] });
    coreFloorsWorkflow = cicd({ invokes: [this.gate] });
    explicit = cicd({
      path: ".github/workflows/kept.yml",
      invokes: [this.gate],
    });
  }
  const paths = discoverCiFiles(new B()).map((f) => f.path).sort();
  assertEquals(paths, [
    ".github/workflows/core-floors.yml",
    ".github/workflows/kept.yml",
    ".github/workflows/release.yml",
  ]);
});

Deno.test("provider defaults to github, and permissions to read-only", () => {
  const yaml = generateCi({ jobs: [{ steps: [{ run: "x" }] }] }, "github");
  // Least privilege by default; a job that writes declares it.
  assertStringIncludes(yaml, "permissions:\n  contents: read");
  // An explicit empty map is stricter than the default, not absent.
  const none = generateCi({
    permissions: {},
    jobs: [{ steps: [{ run: "x" }] }],
  }, "github");
  assertStringIncludes(none, "permissions: {}");
});

Deno.test("the prelude action needs no resolver, since it carries its own pin", () => {
  // Hardening and checkout stay off without a resolver, because there is no
  // reference to render them with. The prelude action is different: it ships a
  // pin, so a build that configures nothing still gets the standard opening.
  class B extends Build {
    gate = target().executes(() => {});
    wf = cicd({ invokes: [this.gate] });
  }
  const yaml = discoverCiFiles(new B())[0].render();
  assertStringIncludes(yaml, "uses: zuke-build/zuke@");
  // With its version comment, so a bot's bump to this file reads as newer than
  // the constant and is not reverted by the next regeneration.
  assertEquals(/uses: zuke-build\/zuke@[0-9a-f]{40} # v\d/.test(yaml), true);
});

Deno.test("bootstrap: false renders the separate steps it replaced", () => {
  // The escape hatch for a repository that cannot use a Marketplace action.
  class B extends Build {
    gate = target().executes(() => {});
    wf = cicd({
      pins: (action) => `${action}@${"c".repeat(40)}`,
      pipeline: { bootstrap: false },
      invokes: [this.gate],
    });
  }
  const yaml = discoverCiFiles(new B())[0].render();
  assertEquals(yaml.includes("zuke-build/zuke"), false);
  assertStringIncludes(yaml, `step-security/harden-runner@${"c".repeat(40)}`);
  assertStringIncludes(yaml, `actions/checkout@${"c".repeat(40)}`);
});

Deno.test("a job that declines either half falls back to the separate steps", () => {
  // One action cannot do half of itself, so `harden: false` — a job that
  // deliberately exercises the bootstrap launchers, say — must still be able to
  // opt out. Falling back is what keeps every pre-existing opt-out working.
  class B extends Build {
    gate = target().executes(() => {});
    other = target().executes(() => {});
    wf = cicd({
      pins: (action) => `${action}@${"d".repeat(40)}`,
      invokes: [
        { target: this.gate, harden: false },
        { target: this.other, checkout: false },
      ],
    });
  }
  const yaml = discoverCiFiles(new B())[0].render();
  // Neither job may render the action, and each keeps the half it wanted.
  assertEquals(yaml.includes("zuke-build/zuke"), false);
  assertStringIncludes(yaml, `actions/checkout@${"d".repeat(40)}`);
  assertStringIncludes(yaml, `step-security/harden-runner@${"d".repeat(40)}`);
});

Deno.test("every prelude option maps onto the action's own input names", () => {
  // The point of the substitution: a build declares the same things it always
  // did, and only the step count changes.
  class B extends Build {
    gate = target().executes(() => {});
    wf = cicd({
      pins: (action) => `${action}@${"e".repeat(40)}`,
      invokes: [{
        target: this.gate,
        harden: { egress: "block", allowedEndpoints: ["jsr.io:443", "x:443"] },
        checkout: { persistCredentials: true, fetchDepth: 0, ref: "main" },
        bootstrap: { denoVersion: "v2.8.3" },
      }],
    });
  }
  const yaml = discoverCiFiles(new B())[0].render();
  assertStringIncludes(yaml, "egress-policy: block");
  assertStringIncludes(yaml, 'allowed-endpoints: "jsr.io:443 x:443"');
  assertStringIncludes(yaml, 'persist-credentials: "true"');
  assertStringIncludes(yaml, 'fetch-depth: "0"');
  assertStringIncludes(yaml, "ref: main");
  // Deno setup folds in too, so the third step disappears with the other two.
  assertStringIncludes(yaml, "deno-version: v2.8.3");
  assertEquals(yaml.includes("denoland/setup-deno"), false);
});

Deno.test("the two security-relevant inputs are always stated", () => {
  // Even when they match the action's own defaults, exactly as the two steps
  // this replaced stated them. Whether a job records egress or enforces it, and
  // whether it leaves a usable credential behind, are what a reader of a
  // generated workflow most needs to see without opening the action to find out
  // what an absent input means.
  class B extends Build {
    gate = target().executes(() => {});
    wf = cicd({
      pins: (action) => `${action}@${"f".repeat(40)}`,
      invokes: [this.gate],
    });
  }
  const yaml = discoverCiFiles(new B())[0].render();
  assertStringIncludes(yaml, "egress-policy: audit");
  assertStringIncludes(yaml, 'persist-credentials: "false"');
});

Deno.test("github: a checkout ref renders on the separate checkout step", () => {
  const yaml = generateCi({
    bootstrap: false,
    checkout: { action: `actions/checkout@${"a".repeat(40)}`, ref: "release" },
    jobs: [{ id: "gate", steps: [{ run: "./zuke gate" }] }],
  }, "github");
  assertStringIncludes(yaml, `actions/checkout@${"a".repeat(40)}`);
  assertStringIncludes(yaml, "ref: release");
});

Deno.test("a checkout without a pin is a friendly error when bootstrap is off", () => {
  // Emitting `uses:` with no ref would be a floating reference; like an
  // unpinned harden, an unpinned checkout must fail rather than degrade.
  assertThrows(
    () =>
      generateCi({
        bootstrap: false,
        checkout: {},
        jobs: [{ steps: [{ run: "x" }] }],
      }, "github"),
    Error,
    "the checkout needs a pinned action",
  );
});

Deno.test("bootstrap: false with no job steps still runs the default step", () => {
  // Opting out of the prelude action must not also lose the default build step.
  const yaml = generateCi(
    { bootstrap: false, jobs: [{ id: "plain" }] },
    "github",
  );
  assertStringIncludes(yaml, "run: ./zuke");
  assertEquals(yaml.includes("zuke-build/zuke"), false);
});

Deno.test("azure: a schedule without a push trigger defaults to main", () => {
  // Azure schedules need a branch filter; with no push trigger to mirror, the
  // conventional default branch stands in.
  const yaml = generateCi(
    { triggers: { schedule: [{ cron: "0 6 * * *" }] } },
    "azure",
  );
  assertStringIncludes(yaml, "schedules:");
  assertStringIncludes(yaml, "branches:\n      include:\n        - main");
});

Deno.test("a job's own bootstrap pin overrides the resolver", () => {
  // A job that names the prelude action asked for that exact pin; the resolver
  // must not replace it.
  class B extends Build {
    gate = target().executes(() => {});
    wf = cicd({
      pins: (action) => `${action}@${"9".repeat(40)}`,
      invokes: [{
        target: this.gate,
        bootstrap: { action: `my-org/zuke@${"8".repeat(40)}` },
      }],
    });
  }
  const yaml = discoverCiFiles(new B())[0].render();
  assertStringIncludes(yaml, `my-org/zuke@${"8".repeat(40)}`);
  assertEquals(yaml.includes("zuke-build/zuke"), false);
});

Deno.test("a field name that is all suffix keeps the provider default path", () => {
  // `Ci` reduces to nothing once the suffix is dropped, so the provider's
  // conventional file name stands in rather than an empty ".yml".
  class B extends Build {
    gate = target().executes(() => {});
    Ci = cicd({ invokes: [this.gate] });
  }
  assertEquals(discoverCiFiles(new B())[0].path, ".github/workflows/ci.yml");
});

Deno.test("pipelineFor names a not-yet-discovered target by identity", () => {
  // Before discoverTargets assigns names, an invoked target can still be
  // resolved by identity against the map — what lets a workflow be declared
  // with `this.ci` in a field initialiser.
  const gate = target().description("Gate").executes(() => {});
  const file = cicd({ provider: "github", invokes: [gate] });
  const pipeline = file.pipelineFor(new Map([["gate", gate]]));
  assertEquals(pipeline.jobs?.[0].id, "gate");
  assertEquals(pipeline.jobs?.[0].name, "Gate");
});

Deno.test("syncCiFiles surfaces a read failure that is not file-absence", async () => {
  // Only NotFound means "write it fresh"; any other read failure (here: the
  // path is a directory) must propagate, not be mistaken for a missing file.
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/ci.yml`;
    await Deno.mkdir(path); // a directory where the file should be
    const file = cicd({ provider: "github", path, pipeline: filePipeline });
    await assertRejects(() => syncCiFiles([file], { check: true }));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a job whose own steps already harden or check out gets no prelude", () => {
  // The prelude became a default for pipelines that never asked for one, so it
  // has to notice a job already doing the work itself — otherwise hardening
  // runs twice and the second checkout quietly undoes what the first fetched.
  // `@zuke/ai` is the case in hand: it builds those two steps directly and
  // cannot say otherwise until its declared core floor has a field to say it
  // with, and every consumer pinned to an older floor is in the same position.
  const yaml = generateCi({
    jobs: [{
      id: "review",
      steps: [
        { uses: `step-security/harden-runner@${"a".repeat(40)}` },
        { uses: `actions/checkout@${"b".repeat(40)}` },
        { run: "./zuke review" },
      ],
    }],
  }, "github");
  assertEquals(yaml.includes("zuke-build/zuke"), false);
  assertStringIncludes(yaml, `harden-runner@${"a".repeat(40)}`);
});

Deno.test("a job with unrelated `uses:` steps still gets the prelude", () => {
  // The guard keys on the two actions the prelude replaces, not on any action:
  // a job that sets up a toolchain has said nothing about hardening.
  const yaml = generateCi({
    jobs: [{
      id: "build",
      steps: [
        { uses: `denoland/setup-deno@${"c".repeat(40)}` },
        { run: "./zuke build" },
      ],
    }],
  }, "github");
  assertStringIncludes(yaml, "uses: zuke-build/zuke@");
  assertStringIncludes(yaml, `setup-deno@${"c".repeat(40)}`);
});

Deno.test("a checkout part-way through a job does not strip its prelude", () => {
  // The prelude is positional: it is what a job does before anything else, so
  // only the first step can be one. A job that checks a second repository out
  // half way through — vendoring a dependency, say — has not built its own
  // prelude, and reading it as one would strip the hardening and the primary
  // checkout it relies on. Silently, since the job still has a checkout in it.
  const yaml = generateCi({
    jobs: [{
      id: "vendor",
      steps: [
        { run: "echo prepare" },
        {
          uses: `actions/checkout@${"a".repeat(40)}`,
          with: { repository: "other/repo", path: "vendor" },
        },
        { run: "./zuke build" },
      ],
    }],
  }, "github");
  assertStringIncludes(yaml, "uses: zuke-build/zuke@");
  // And the job's own second checkout survives untouched.
  assertStringIncludes(yaml, "repository: other/repo");
});
