// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { NodeTasks } from "../../packages/node/mod.ts";
import { runCli } from "./_harness.ts";

// `NodeTasks.evaluate` is the one task that hands a *value* back to the target
// rather than a `CommandOutput`, so what a build sees when Node is missing has
// to be the ordinary "tool not found" failure — not a parse error from the
// empty output that follows it.
class SpecBuild extends Build {
  spec = target()
    .description("read a value out of a Node module")
    .executes(async () => {
      const document = await NodeTasks.evaluate(
        "tools/openapi.mjs",
        (s) => missingTool(s),
      );
      console.log(`document=${JSON.stringify(document)}`);
    });
}

// `exitAfterResult` changes when the child stops, never how a failure to run it
// at all is reported: a build that sets it must still fail the same way.
class ExitAfterResultBuild extends Build {
  spec = target()
    .description("read a value out of a module that never exits on its own")
    .executes(async () => {
      const document = await NodeTasks.evaluate(
        "tools/openapi.mjs",
        (s) => missingTool(s.exitAfterResult()),
      );
      console.log(`document=${JSON.stringify(document)}`);
    });
}

Deno.test("a target evaluating a Node module fails with the tool-not-found error", async () => {
  const { code, out, err } = await runCli(SpecBuild, ["spec"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "zuke-no-such-tool-xyz");
  // The target never reached its value, so it printed nothing.
  assertEquals(out.includes("document="), false);
});

Deno.test("exitAfterResult leaves the tool-not-found failure unchanged", async () => {
  const { code, out, err } = await runCli(ExitAfterResultBuild, ["spec"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "zuke-no-such-tool-xyz");
  assertEquals(out.includes("document="), false);
});
