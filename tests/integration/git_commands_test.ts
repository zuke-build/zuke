// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the broadened `@zuke/git` surface driven from a real build
 * through the CLI `main()`. The unit tests assert argv; this proves the tasks
 * are reachable as a target's body — that a value-returning one fails the
 * build when git is missing rather than reporting an empty result, and that a
 * settings class's own validation surfaces as a failed target rather than
 * being swallowed by the executor.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { GitTasks } from "../../packages/git/mod.ts";
import { runCli } from "./_harness.ts";

class ReleaseBuild extends Build {
  changed = target()
    .description("report the files this branch changed")
    .executes(async () => {
      const files = await GitTasks.diffNames((s) =>
        missingTool(s).mergeBase("origin/main")
      );
      console.log(`changed=${files.length}`);
    });

  notes = target()
    .description("collect the commits since the last tag")
    .executes(async () => {
      const commits = await GitTasks.logEntries((s) =>
        missingTool(s).range("v1.0.0").noMerges()
      );
      console.log(`commits=${commits.length}`);
    });

  dirty = target()
    .description("refuse to release from a dirty tree")
    .executes(async () => {
      const entries = await GitTasks.statusEntries((s) => missingTool(s));
      console.log(`dirty=${entries.length}`);
    });

  package_ = target()
    .description("archive the tagged tree")
    .executes(async () => {
      await GitTasks.archive((s) =>
        missingTool(s).format("tar.gz").output("dist/app.tgz").treeish("HEAD")
      );
      console.log("archived");
    });

  integrate = target()
    .description("bring the base branch in")
    .executes(async () => {
      await GitTasks.merge((s) => missingTool(s).noFf().refs("origin/main"));
      console.log("merged");
    });

  wipe = target()
    .description("a clean that never says which way it meant to go")
    .executes(async () => {
      // No `.force()` and no `.dryRun()`: the settings refuse this before git
      // is ever spawned, and the target must fail with that message.
      await GitTasks.clean((s) => missingTool(s).directories());
      console.log("cleaned");
    });
}

const FAILS_ON_MISSING_GIT: Array<[string, string]> = [
  ["changed", "changed="],
  ["notes", "commits="],
  ["dirty", "dirty="],
  ["package_", "archived"],
  ["integrate", "merged"],
];

for (const [name, marker] of FAILS_ON_MISSING_GIT) {
  Deno.test(`the ${name} target fails with the tool-not-found error`, async () => {
    const { code, out, err } = await runCli(ReleaseBuild, [name]);
    assertEquals(code, 1);
    assertStringIncludes(err, "zuke-no-such-tool-xyz");
    assertEquals(out.includes(marker), false);
  });
}

Deno.test("a settings validation failure fails the target, naming the fix", async () => {
  const { code, out, err } = await runCli(ReleaseBuild, ["wipe"]);
  assertEquals(code, 1);
  assertStringIncludes(err, ".force()");
  assertEquals(out.includes("cleaned"), false);
});
