// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { GitTasks } from "../../packages/git/mod.ts";
import { runCli } from "./_harness.ts";

// `worktreeList` is the task that hands a *value* back to the target rather
// than a `CommandOutput`, so a build has to see the ordinary tool-not-found
// failure when git is missing, not a parse of empty output that reports zero
// worktrees and carries on.
class SessionsBuild extends Build {
  create = target()
    .description("check a second working tree out of this repository")
    .executes(async () => {
      await GitTasks.worktree((s) =>
        missingTool(s.add("../feature").branch("feature").createBranch())
      );
      console.log("created");
    });

  ticket = target()
    .description("branch a worktree off the remote's default")
    .executes(async () => {
      await GitTasks.worktree((s) =>
        missingTool(
          s.add("../ticket").branch("ticket").createBranch().startPoint(
            "origin/main",
          ),
        )
      );
      console.log("created");
    });

  report = target()
    .description("report the repository's worktrees")
    .executes(async () => {
      const trees = await GitTasks.worktreeList((s) => missingTool(s));
      console.log(`count=${trees.length}`);
    });
}

Deno.test("a target creating a worktree fails with the tool-not-found error", async () => {
  const { code, out, err } = await runCli(SessionsBuild, ["create"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "zuke-no-such-tool-xyz");
  assertEquals(out.includes("created"), false);
});

Deno.test("a start-point worktree reaches git like any other", async () => {
  const { code, out, err } = await runCli(SessionsBuild, ["ticket"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "zuke-no-such-tool-xyz");
  assertEquals(out.includes("created"), false);
});

Deno.test("a missing git fails the listing rather than reporting no worktrees", async () => {
  const { code, out, err } = await runCli(SessionsBuild, ["report"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "zuke-no-such-tool-xyz");
  assertEquals(out.includes("count="), false);
});
