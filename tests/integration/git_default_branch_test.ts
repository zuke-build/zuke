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

// `defaultBranch` tries two commands and swallows the first one's failure to
// reach the second. A build must still see the ordinary tool-not-found error
// rather than a swallowed one, or an empty answer that reads as a branch name.
class BaseBuild extends Build {
  base = target()
    .description("resolve the branch new work forks from")
    .executes(async () => {
      const branch = await GitTasks.defaultBranch((s) => missingTool(s));
      console.log(`base=${branch}`);
    });
}

Deno.test("a missing git fails the default-branch lookup, both attempts", async () => {
  const { code, out, err } = await runCli(BaseBuild, ["base"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "zuke-no-such-tool-xyz");
  assertEquals(out.includes("base="), false);
});
