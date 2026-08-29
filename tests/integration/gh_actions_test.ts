// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the `@zuke/gh` Actions and repository groups driven from a real
 * build through the CLI `main()`. The unit tests assert argv; this proves the
 * tasks are reachable as a target's body — that a value-returning one fails
 * the build when `gh` is missing rather than reporting an empty repository,
 * and that a settings class's own validation surfaces as a failed target.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { GhTasks } from "../../packages/gh/mod.ts";
import { runCli } from "./_harness.ts";

class ActionsBuild extends Build {
  failures = target()
    .description("report the runs that failed on the default branch")
    .executes(async () => {
      const entries = await GhTasks.runListEntries((s) =>
        missingTool(s).status("failure").branch("master").limit(20)
      );
      console.log(`failed=${entries.length}`);
    });

  retry = target()
    .description("rerun the failed jobs of the last run")
    .executes(async () => {
      await GhTasks.runRerun((s) => missingTool(s).selector(123).failed());
      console.log("reran");
    });

  artifacts = target()
    .description("collect a run's coverage artifact")
    .executes(async () => {
      await GhTasks.runDownload((s) =>
        missingTool(s).selector(123).name("coverage").dir("artifacts")
      );
      console.log("downloaded");
    });

  dispatch = target()
    .description("dispatch the e2e workflow against a ref")
    .executes(async () => {
      await GhTasks.workflowRun((s) =>
        missingTool(s).workflow("e2e.yml").ref("master").field("env", "staging")
      );
      console.log("dispatched");
    });

  rotate = target()
    .description("rotate the registry token the release job reads")
    .executes(async () => {
      await GhTasks.secretSet((s) =>
        missingTool(s).name("NPM_TOKEN").body("rotated")
      );
      console.log("rotated");
    });

  region = target()
    .description("read the deployment region out of an Actions variable")
    .executes(async () => {
      const value = await GhTasks.variableValue((s) =>
        missingTool(s).name("REGION")
      );
      console.log(`region=${value}`);
    });

  reclaim = target()
    .description("reclaim the Actions caches of a merged branch")
    .executes(async () => {
      await GhTasks.cacheDelete((s) =>
        missingTool(s).all().ref("refs/heads/feature").succeedOnNoCaches()
      );
      console.log("reclaimed");
    });

  inventory = target()
    .description("report the organization's repositories")
    .executes(async () => {
      const entries = await GhTasks.repoListEntries((s) =>
        missingTool(s).owner("acme").noArchived()
      );
      console.log(`repos=${entries.length}`);
    });

  vendor = target()
    .description("clone a dependency shallowly into the vendor directory")
    .executes(async () => {
      await GhTasks.repoClone((s) =>
        missingTool(s).repository("acme/app").directory("vendor/app").gitArgs(
          "--depth=1",
        )
      );
      console.log("cloned");
    });

  triageLabel = target()
    .description("make sure the triage label exists")
    .executes(async () => {
      await GhTasks.labelCreate((s) =>
        missingTool(s).name("flaky").color("d73a4a").force()
      );
      console.log("labelled");
    });

  mistake = target()
    .description("delete a repository without naming it")
    .executes(async () => {
      // The settings refuse this before gh is ever spawned: gh ignores --yes
      // when deleting the repository you are standing in and always prompts,
      // which a build cannot answer.
      await GhTasks.repoDelete((s) => missingTool(s).yes());
      console.log("deleted");
    });
}

const FAILS_ON_MISSING_GH: Array<[string, string]> = [
  ["failures", "failed="],
  ["retry", "reran"],
  ["artifacts", "downloaded"],
  ["dispatch", "dispatched"],
  ["rotate", "rotated"],
  ["region", "region="],
  ["reclaim", "reclaimed"],
  ["inventory", "repos="],
  ["vendor", "cloned"],
  ["triageLabel", "labelled"],
];

for (const [name, marker] of FAILS_ON_MISSING_GH) {
  Deno.test(`the ${name} target fails with the tool-not-found error`, async () => {
    const { code, out, err } = await runCli(ActionsBuild, [name]);
    assertEquals(code, 1);
    assertStringIncludes(err, "zuke-no-such-tool-xyz");
    assertEquals(out.includes(marker), false);
  });
}

Deno.test("a settings validation failure fails the target, naming the fix", async () => {
  const { code, out, err } = await runCli(ActionsBuild, ["mistake"]);
  assertEquals(code, 1);
  assertStringIncludes(err, ".repository(...) is required");
  assertEquals(out.includes("deleted"), false);
});
