// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Job environments and outputs, sparse matrices, and trigger path filters,
 * across every provider: rendered where the provider can carry them, refused
 * where dropping them would change what the pipeline runs or guards.
 */

import { assertEquals, assertStringIncludes, assertThrows } from "./_assert.ts";
import {
  cicd,
  type CiJob,
  type CiPipeline,
  type CiProvider,
  generateCi,
} from "../src/ci.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";

/** A pipeline of one job, with no bootstrap noise in the output. */
function oneJob(job: CiJob, extra: CiPipeline = {}): CiPipeline {
  return {
    bootstrap: false,
    ...extra,
    jobs: [{ id: "deploy", steps: [{ run: "./zuke deploy" }], ...job }],
  };
}

const PAGES_URL = "${{ steps.deployment.outputs.page_url }}";

// --- environment ------------------------------------------------------------

Deno.test("github: a named environment renders as a bare name", () => {
  const yaml = generateCi(oneJob({ environment: "production" }), "github");
  assertStringIncludes(yaml, "    environment: production\n");
});

Deno.test("github: an environment URL expression is preserved verbatim", () => {
  const yaml = generateCi(
    oneJob({ environment: { name: "github-pages", url: PAGES_URL } }),
    "github",
  );
  assertStringIncludes(
    yaml,
    `    environment:\n      name: github-pages\n      url: "${PAGES_URL}"\n`,
  );
});

Deno.test("github: an environment without a URL renders only the name", () => {
  const yaml = generateCi(
    oneJob({ environment: { name: "staging" } }),
    "github",
  );
  assertStringIncludes(yaml, "    environment:\n      name: staging\n");
  assertEquals(yaml.includes("url:"), false);
});

Deno.test("an omitted environment or outputs leaves the output unchanged", () => {
  for (const provider of ["github", "gitlab", "azure", "bitbucket"] as const) {
    const yaml = generateCi(oneJob({}), provider);
    assertEquals(yaml.includes("environment"), false, provider);
    assertEquals(yaml.includes("outputs"), false, provider);
  }
});

Deno.test("gitlab: an environment renders with the same name and url", () => {
  assertStringIncludes(
    generateCi(oneJob({ environment: "review" }), "gitlab"),
    "  environment: review\n",
  );
  assertStringIncludes(
    generateCi(
      oneJob({ environment: { name: "prod", url: "https://example.com" } }),
      "gitlab",
    ),
    `  environment:\n    name: prod\n    url: "https://example.com"\n`,
  );
});

Deno.test("azure and bitbucket refuse an environment rather than drop it", () => {
  // Dropping it would also drop the approval gate the environment carries.
  for (const provider of ["azure", "bitbucket"] as const) {
    assertThrows(
      () => generateCi(oneJob({ environment: "production" }), provider),
      Error,
      `job "deploy" sets \`environment\``,
    );
  }
});

// --- outputs ----------------------------------------------------------------

Deno.test("github: job outputs render verbatim for a consumer to read", () => {
  const yaml = generateCi({
    bootstrap: false,
    jobs: [
      {
        id: "deploy",
        outputs: { "page-url": PAGES_URL },
        steps: [{ id: "deployment", run: "./zuke deploy" }],
      },
      {
        id: "smoke",
        needs: ["deploy"],
        steps: [{
          run: "./zuke smoke",
          env: { DEPLOYMENT_URL: "${{ needs.deploy.outputs.page-url }}" },
        }],
      },
    ],
  }, "github");
  assertStringIncludes(yaml, `    outputs:\n      page-url: "${PAGES_URL}"\n`);
  // Step ids and needs derivation are untouched.
  assertStringIncludes(yaml, "id: deployment");
  assertStringIncludes(yaml, "needs:\n      - deploy");
  assertStringIncludes(yaml, "needs.deploy.outputs.page-url");
});

Deno.test("only github carries job outputs; the rest refuse them", () => {
  for (const provider of ["gitlab", "azure", "bitbucket"] as const) {
    assertThrows(
      () => generateCi(oneJob({ outputs: { url: PAGES_URL } }), provider),
      Error,
      `job "deploy" sets \`outputs\``,
    );
  }
});

Deno.test("a DST-guarded schedule keeps a job's own outputs and environment", () => {
  const yaml = generateCi(
    oneJob(
      { environment: "production", outputs: { url: PAGES_URL } },
      { triggers: { schedule: [{ cron: "0 9 * * 1", tz: "Europe/Sofia" }] } },
    ),
    "github",
  );
  assertStringIncludes(yaml, "environment: production");
  assertStringIncludes(yaml, `url: "${PAGES_URL}"`);
  // The guard job's own output is still there beside it.
  assertStringIncludes(yaml, `run: "\${{ steps.check.outputs.run }}"`);
});

// --- sparse matrices --------------------------------------------------------

const FORGE_ROWS = [
  { node: "22.22.2", os: "ubuntu-latest" },
  { node: "22", os: "ubuntu-latest" },
  { node: "24", os: "ubuntu-latest" },
  { node: "26", os: "ubuntu-latest" },
  { node: "26", os: "macos-latest" },
];

Deno.test("github: an include-only matrix renders its rows and picks the runner", () => {
  const yaml = generateCi(
    oneJob({ failFast: false, matrixInclude: FORGE_ROWS }),
    "github",
  );
  assertStringIncludes(yaml, `runs-on: "\${{ matrix.os }}"`);
  assertStringIncludes(
    yaml,
    "    strategy:\n      fail-fast: false\n      matrix:\n        include:\n" +
      `          - node: 22.22.2\n            os: ubuntu-latest\n` +
      `          - node: "22"\n            os: ubuntu-latest\n`,
  );
  assertEquals(yaml.split("- node:").length - 1, 5);
  assertEquals(yaml.includes("exclude"), false);
});

Deno.test("github: axes plus exclude render natively beside each other", () => {
  const yaml = generateCi(
    oneJob({
      matrix: { os: ["ubuntu-latest", "windows-latest"], node: ["22", "24"] },
      matrixExclude: [{ os: "windows-latest", node: "22" }],
    }),
    "github",
  );
  assertStringIncludes(
    yaml,
    "      matrix:\n        os:\n          - ubuntu-latest\n" +
      "          - windows-latest\n        node:",
  );
  assertStringIncludes(
    yaml,
    `        exclude:\n          - os: windows-latest\n            node: "22"\n`,
  );
  assertStringIncludes(yaml, `runs-on: "\${{ matrix.os }}"`);
});

Deno.test("github: axes plus an extending include keep the axis runner", () => {
  const yaml = generateCi(
    oneJob({
      matrix: { os: ["ubuntu-latest", "macos-latest"] },
      matrixInclude: [{ os: "macos-latest", experimental: "true" }],
    }),
    "github",
  );
  assertStringIncludes(yaml, `runs-on: "\${{ matrix.os }}"`);
  assertStringIncludes(yaml, "        include:\n          - os: macos-latest");
});

Deno.test("github: a matrix without os runs on runsOn", () => {
  const yaml = generateCi(
    oneJob({ runsOn: "windows-latest", matrixInclude: [{ node: "22" }] }),
    "github",
  );
  assertStringIncludes(yaml, "runs-on: windows-latest");
});

Deno.test("github: os in only some rows is refused, not an empty runner", () => {
  assertThrows(
    () =>
      generateCi(
        oneJob({ matrixInclude: [{ os: "macos-latest" }, { node: "22" }] }),
        "github",
      ),
    Error,
    `job "deploy" sets \`os\` in only some matrix combinations`,
  );
});

Deno.test("gitlab: a sparse matrix lists exactly its combinations", () => {
  const yaml = generateCi(oneJob({ matrixInclude: FORGE_ROWS }), "gitlab");
  assertStringIncludes(
    yaml,
    "  parallel:\n    matrix:\n      - node: 22.22.2\n        os: ubuntu-latest\n",
  );
  assertEquals(yaml.split("- node:").length - 1, 5);
});

Deno.test("gitlab: an excluded combination is absent from the expansion", () => {
  const yaml = generateCi(
    oneJob({
      matrix: { os: ["linux", "win"], node: ["22", "24"] },
      matrixExclude: [{ os: "win", node: "22" }],
    }),
    "gitlab",
  );
  // Three combinations, each listed with scalar values, so GitLab cannot
  // multiply them back out into the excluded pairing.
  assertEquals(yaml.split("- os:").length - 1, 3);
  assertEquals(yaml.includes(`os: win\n        node: "22"`), false);
  assertStringIncludes(yaml, `os: win\n        node: "24"`);
});

Deno.test("gitlab: axes alone keep GitLab's own product form", () => {
  const yaml = generateCi(
    oneJob({ matrix: { os: ["linux", "win"] } }),
    "gitlab",
  );
  assertStringIncludes(
    yaml,
    "  parallel:\n    matrix:\n      - os:\n          - linux\n          - win\n",
  );
});

Deno.test("azure: a sparse matrix becomes exactly its named configurations", () => {
  const yaml = generateCi(oneJob({ matrixInclude: FORGE_ROWS }), "azure");
  assertStringIncludes(yaml, "22.22.2_ubuntu-latest:");
  assertStringIncludes(yaml, "26_macos-latest:");
  assertEquals(yaml.includes("24_macos-latest"), false);
  assertEquals(yaml.split("_ubuntu-latest:").length - 1, 4);
});

Deno.test("azure: rows that share a configuration name are refused", () => {
  assertThrows(
    () =>
      generateCi(
        oneJob({ matrixInclude: [{ a: "x" }, { b: "x" }] }),
        "azure",
      ),
    Error,
    `two matrix combinations named "x"`,
  );
});

Deno.test("a bad exclude row is an error on every provider that renders matrices", () => {
  for (const provider of ["github", "gitlab", "azure"] as const) {
    assertThrows(
      () =>
        generateCi(
          oneJob({
            matrix: { os: ["linux"] },
            matrixExclude: [{ nope: "x" }],
          }),
          provider,
        ),
      Error,
      `excludes on "nope"`,
    );
  }
});

Deno.test("an axis named include or exclude is refused on every matrix provider", () => {
  // GitHub would read the axis as its own row list and drop or overwrite it.
  for (const provider of ["github", "gitlab", "azure"] as const) {
    for (const name of ["include", "exclude"]) {
      assertThrows(
        () => generateCi(oneJob({ matrix: { [name]: ["a", "b"] } }), provider),
        Error,
        `has a matrix axis named "${name}"`,
      );
    }
  }
});

Deno.test("gitlab: an axis with no values is refused, as on github and azure", () => {
  for (const provider of ["github", "gitlab", "azure"] as const) {
    assertThrows(
      () => generateCi(oneJob({ matrix: { os: [] } }), provider),
      Error,
      "no combinations left",
    );
  }
});

// --- path filters -----------------------------------------------------------

const WEBSITE = ["website/**", ".github/workflows/website-project.yml"];

Deno.test("github: per-event paths and paths-ignore render under each trigger", () => {
  const yaml = generateCi(
    oneJob({}, {
      triggers: {
        push: ["main"],
        pushPaths: { paths: WEBSITE },
        pullRequest: ["main"],
        pullRequestTypes: ["opened"],
        pullRequestPaths: { pathsIgnore: ["docs/**"] },
      },
    }),
    "github",
  );
  assertStringIncludes(
    yaml,
    "  push:\n    branches:\n      - main\n    paths:\n" +
      `      - "website/**"\n      - .github/workflows/website-project.yml\n`,
  );
  assertStringIncludes(
    yaml,
    "  pull_request:\n    branches:\n      - main\n    types:\n      - opened\n" +
      `    paths-ignore:\n      - "docs/**"\n`,
  );
});

Deno.test("github: a path filter on an every-branch trigger has no branches key", () => {
  const yaml = generateCi(
    oneJob({}, { triggers: { push: [], pushPaths: { paths: ["src/**"] } } }),
    "github",
  );
  assertStringIncludes(yaml, `  push:\n    paths:\n      - "src/**"\n`);
});

Deno.test("a path filter needs the event it narrows, on every provider", () => {
  for (const provider of ["github", "gitlab", "azure", "bitbucket"] as const) {
    assertThrows(
      () =>
        generateCi(
          oneJob({}, {
            triggers: { push: ["main"], pullRequestPaths: { paths: ["x"] } },
          }),
          provider,
        ),
      Error,
      "`triggers.pullRequestPaths` narrows the pullRequest trigger",
    );
  }
});

Deno.test("an empty path filter is refused rather than read two ways", () => {
  assertThrows(
    () =>
      generateCi(
        oneJob({}, { triggers: { push: ["main"], pushPaths: { paths: [] } } }),
        "github",
      ),
    Error,
    "needs at least one pattern",
  );
});

Deno.test("a filter setting both lists is refused, as GitHub would", () => {
  assertThrows(
    () =>
      generateCi(
        oneJob({}, {
          triggers: {
            push: ["main"],
            // @ts-expect-error — the type forbids both lists; this exercises the
            // runtime guard a JavaScript caller (or a cast) could still reach.
            pushPaths: { paths: ["a"], pathsIgnore: ["b"] },
          },
        }),
        "github",
      ),
    Error,
    "sets both `paths` and `pathsIgnore`",
  );
});

Deno.test("azure: path filters use the include/exclude pair", () => {
  const yaml = generateCi(
    oneJob({}, {
      triggers: {
        push: ["main"],
        pushPaths: { paths: WEBSITE },
        pullRequest: [],
        pullRequestPaths: { pathsIgnore: ["docs/**"] },
      },
    }),
    "azure",
  );
  assertStringIncludes(
    yaml,
    "trigger:\n  branches:\n    include:\n      - main\n  paths:\n" +
      `    include:\n      - "website/**"\n`,
  );
  assertStringIncludes(
    yaml,
    `pr:\n  branches:\n    include:\n      - "*"\n  paths:\n    exclude:\n` +
      `      - "docs/**"\n`,
  );
});

Deno.test("gitlab: paths become a changes: clause on each trigger rule", () => {
  const yaml = generateCi(
    oneJob({}, {
      triggers: {
        push: ["main"],
        pushPaths: { paths: WEBSITE },
        pullRequest: ["main"],
        pullRequestPaths: { paths: ["website/**"] },
      },
    }),
    "gitlab",
  );
  assertEquals(yaml.split("changes:").length - 1, 2);
  assertStringIncludes(yaml, `      changes:\n        - "website/**"\n`);
});

Deno.test("gitlab: an every-branch push filter gets a push-source rule", () => {
  const yaml = generateCi(
    oneJob({}, { triggers: { push: [], pushPaths: { paths: ["src/**"] } } }),
    "gitlab",
  );
  // Any branch, like the per-branch rules — not only the `push` source, which
  // would also shut out scheduled, API and trigger pipelines.
  assertStringIncludes(yaml, `- if: "$CI_COMMIT_BRANCH"\n`);
  assertEquals(yaml.includes("CI_PIPELINE_SOURCE"), false);
  assertStringIncludes(yaml, `      changes:\n        - "src/**"\n`);
});

Deno.test("gitlab refuses pathsIgnore; bitbucket refuses any path filter", () => {
  const cases: Array<[CiProvider, CiPipeline, string]> = [
    [
      "gitlab",
      oneJob({}, {
        triggers: { push: ["main"], pushPaths: { pathsIgnore: ["d/**"] } },
      }),
      "`triggers.pushPaths` cannot be expressed for GitLab",
    ],
    [
      "gitlab",
      oneJob({}, {
        triggers: {
          pullRequest: ["main"],
          pullRequestPaths: { pathsIgnore: ["d/**"] },
        },
      }),
      "`triggers.pullRequestPaths` cannot be expressed for GitLab",
    ],
    [
      "bitbucket",
      oneJob({}, {
        triggers: { push: ["main"], pushPaths: { paths: ["src/**"] } },
      }),
      "`triggers.pushPaths` cannot be expressed for Bitbucket",
    ],
    [
      "bitbucket",
      oneJob({}, {
        triggers: {
          pullRequest: ["main"],
          pullRequestPaths: { paths: ["src/**"] },
        },
      }),
      "`triggers.pullRequestPaths` cannot be expressed for Bitbucket",
    ],
  ];
  for (const [provider, pipeline, message] of cases) {
    assertThrows(() => generateCi(pipeline, provider), Error, message);
  }
});

// --- invokes ----------------------------------------------------------------

Deno.test("invokes: environment, outputs and sparse matrix reach the job", () => {
  class B extends Build {
    deploy = target().executes(() => {});
    test = target().executes(() => {});
    wf = cicd({
      provider: "github",
      invokes: [
        {
          target: this.deploy,
          environment: { name: "github-pages", url: PAGES_URL },
          outputs: { "page-url": PAGES_URL },
        },
        {
          target: this.test,
          matrixInclude: FORGE_ROWS,
        },
      ],
    });
  }
  const b = new B();
  const jobs = b.wf.pipelineFor(discoverTargets(b)).jobs;
  assertEquals(jobs?.[0].environment, { name: "github-pages", url: PAGES_URL });
  assertEquals(jobs?.[0].outputs, { "page-url": PAGES_URL });
  assertEquals(jobs?.[1].matrixInclude, FORGE_ROWS);
  const yaml = generateCi(b.wf.pipelineFor(discoverTargets(b)), "github");
  assertStringIncludes(yaml, "name: github-pages");
  assertStringIncludes(yaml, "page-url:");
  assertStringIncludes(yaml, "include:");
});

Deno.test("invokes: matrixExclude is carried to the job", () => {
  class B extends Build {
    test = target().executes(() => {});
    wf = cicd({
      provider: "github",
      invokes: [{
        target: this.test,
        matrix: { os: ["ubuntu-latest", "windows-latest"] },
        matrixExclude: [{ os: "windows-latest" }],
      }],
    });
  }
  const b = new B();
  const job = b.wf.pipelineFor(discoverTargets(b)).jobs?.[0];
  assertEquals(job?.matrixExclude, [{ os: "windows-latest" }]);
});
