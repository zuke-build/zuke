// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the typed `@zuke/gh` command groups driven from a real build
 * through the CLI `main()`. The unit tests assert argv; this proves the tasks
 * are reachable as a target's body — that a value-returning one fails the
 * build when `gh` is missing rather than reporting an empty repository, and
 * that a settings class's own validation surfaces as a failed target.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { GhTasks } from "../../packages/gh/mod.ts";
import { runCli } from "./_harness.ts";

class ReleaseBuild extends Build {
  open = target()
    .description("report the pull requests still open")
    .executes(async () => {
      const entries = await GhTasks.prListEntries((s) =>
        missingTool(s).state("open").limit(5)
      );
      console.log(`open=${entries.length}`);
    });

  triage = target()
    .description("report the issues waiting on triage")
    .executes(async () => {
      const entries = await GhTasks.issueListEntries((s) =>
        missingTool(s).label("bug")
      );
      console.log(`bugs=${entries.length}`);
    });

  published = target()
    .description("report the releases already published")
    .executes(async () => {
      const entries = await GhTasks.releaseListEntries((s) =>
        missingTool(s).excludeDrafts()
      );
      console.log(`released=${entries.length}`);
    });

  announce = target()
    .description("publish the release for the tag just pushed")
    .executes(async () => {
      await GhTasks.releaseCreate((s) =>
        missingTool(s).tag("v1.2.3").generateNotes().latest()
      );
      console.log("announced");
    });

  attach = target()
    .description("attach the built artifact to the release")
    .executes(async () => {
      await GhTasks.releaseUpload((s) =>
        missingTool(s).tag("v1.2.3").files("dist/app.tgz").clobber()
      );
      console.log("attached");
    });

  report = target()
    .description("comment the build's result on the pull request")
    .executes(async () => {
      await GhTasks.prComment((s) =>
        missingTool(s).selector(1).body("CI is green").editLast()
      );
      console.log("reported");
    });

  file = target()
    .description("open an issue for the failure just seen")
    .executes(async () => {
      await GhTasks.issueCreate((s) =>
        missingTool(s).title("flaky test").body("it fails on Windows")
          .label("bug")
      );
      console.log("filed");
    });

  land = target()
    .description("merge the pull request once its checks pass")
    .executes(async () => {
      await GhTasks.prMerge((s) => missingTool(s).selector(1).squash().auto());
      console.log("landed");
    });

  mistake = target()
    .description("delete a release without meaning it")
    .executes(async () => {
      // The settings refuse this before gh is ever spawned: gh would prompt
      // for a confirmation the build has no one to answer.
      await GhTasks.releaseDelete((s) => missingTool(s).tag("v1.2.3"));
      console.log("deleted");
    });
}

const FAILS_ON_MISSING_GH: Array<[string, string]> = [
  ["open", "open="],
  ["triage", "bugs="],
  ["published", "released="],
  ["announce", "announced"],
  ["attach", "attached"],
  ["report", "reported"],
  ["file", "filed"],
  ["land", "landed"],
];

for (const [name, marker] of FAILS_ON_MISSING_GH) {
  Deno.test(`the ${name} target fails with the tool-not-found error`, async () => {
    const { code, out, err } = await runCli(ReleaseBuild, [name]);
    assertEquals(code, 1);
    assertStringIncludes(err, "zuke-no-such-tool-xyz");
    assertEquals(out.includes(marker), false);
  });
}

Deno.test("a settings validation failure fails the target, naming the fix", async () => {
  const { code, out, err } = await runCli(ReleaseBuild, ["mistake"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "add .yes() to mean it");
  assertEquals(out.includes("deleted"), false);
});
