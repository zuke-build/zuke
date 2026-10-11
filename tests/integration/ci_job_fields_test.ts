// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a deploy-shaped build — a GitHub Pages job with an environment
 * and an output, a smoke job reading that output, a sparse test matrix, and
 * path-filtered triggers — generated end to end through `generate-ci` in the
 * real CLI `main()`, then held to `--check`. Also covers a provider that must
 * refuse one of those fields stopping the command with the reason.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, cicd, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

/** Run `fn` with the process cwd set to a fresh temp dir, cleaning up after. */
async function inTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-ci-fields-" });
  const prev = Deno.cwd();
  Deno.chdir(dir);
  try {
    await fn(dir);
  } finally {
    Deno.chdir(prev);
    await Deno.remove(dir, { recursive: true });
  }
}

const PAGE_URL = "${{ steps.deployment.outputs.page_url }}";

class WebsiteBuild extends Build {
  test = target().description("Test the generator").executes(() => {});
  deploy = target().description("Deploy the site").dependsOn(this.test)
    .executes(() => {});
  smoke = target().description("Smoke-test the site").dependsOn(this.deploy)
    .executes(() => {});

  website = cicd({
    provider: "github",
    pipeline: {
      name: "Website",
      triggers: {
        push: ["main"],
        pushPaths: { paths: ["website/**"] },
        pullRequest: ["main"],
        pullRequestPaths: { paths: ["website/**"] },
      },
    },
    invokes: [
      {
        target: this.test,
        failFast: false,
        matrixInclude: [
          { node: "24", os: "ubuntu-latest" },
          { node: "26", os: "ubuntu-latest" },
          { node: "26", os: "macos-latest" },
        ],
      },
      {
        target: this.deploy,
        permissions: { pages: "write", "id-token": "write" },
        environment: { name: "github-pages", url: PAGE_URL },
        outputs: { "page-url": PAGE_URL },
      },
      {
        target: this.smoke,
        env: { DEPLOYMENT_URL: "${{ needs.deploy.outputs.page-url }}" },
      },
    ],
  });
}

Deno.test("generate-ci renders environment, outputs, sparse matrix and path filters", async () => {
  await inTempDir(async (dir) => {
    const { code } = await runCli(WebsiteBuild, ["generate-ci"]);
    assertEquals(code, 0);
    const yaml = await Deno.readTextFile(
      `${dir}/.github/workflows/website.yml`,
    );

    // Triggers carry their own path filters.
    assertStringIncludes(
      yaml,
      `  push:\n    branches:\n      - main\n    paths:\n      - "website/**"\n`,
    );
    assertStringIncludes(
      yaml,
      `  pull_request:\n    branches:\n      - main\n    paths:\n      - "website/**"\n`,
    );
    // Exactly the three listed combinations, on the runner each names.
    assertStringIncludes(yaml, `runs-on: "\${{ matrix.os }}"`);
    assertStringIncludes(yaml, "        include:\n");
    assertEquals(yaml.split("- node:").length - 1, 3);
    // The deploy job's environment and output, verbatim; needs from the graph.
    assertStringIncludes(
      yaml,
      `    environment:\n      name: github-pages\n      url: "${PAGE_URL}"\n`,
    );
    assertStringIncludes(yaml, `    outputs:\n      page-url: "${PAGE_URL}"\n`);
    assertStringIncludes(yaml, "  smoke:\n");
    assertStringIncludes(yaml, "needs:\n      - deploy");
    assertStringIncludes(yaml, "needs.deploy.outputs.page-url");

    // The file just written is current.
    const check = await runCli(WebsiteBuild, ["generate-ci", "--check"]);
    assertEquals(check.code, 0);
  });
});

class AzureDeployBuild extends Build {
  deploy = target().executes(() => {});
  azure = cicd({
    provider: "azure",
    invokes: [{ target: this.deploy, environment: "production" }],
  });
}

Deno.test("generate-ci refuses, naming the field, when a provider cannot carry it", async () => {
  // Rejected before anything is written: a configuration error, raised the way
  // every other `cicd` refusal is, rather than a file missing its approval gate.
  await inTempDir(async (dir) => {
    await assertRejects(
      () => runCli(AzureDeployBuild, ["generate-ci"]),
      Error,
      `job "deploy" sets \`environment\``,
    );
    assertEquals(
      await Deno.stat(`${dir}/azure-pipelines.yml`).then(
        () => true,
        () => false,
      ),
      false,
    );
  });
});
