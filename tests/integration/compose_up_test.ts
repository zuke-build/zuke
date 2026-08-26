// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { DockerComposeTasks } from "../../packages/docker-compose/mod.ts";
import { runCli } from "./_harness.ts";

// The debug shape this exists for: start one service from local source against
// a stack that is already running, and leave its dependencies alone.
class DebugBuild extends Build {
  debug = target()
    .description("start one service without touching its dependencies")
    .executes(async () => {
      await DockerComposeTasks.up((s) =>
        missingTool(s.file("base.yml").services("api").build().noDeps())
      );
      console.log("started");
    });
}

Deno.test("a no-deps compose up reaches docker like any other", async () => {
  const { code, out, err } = await runCli(DebugBuild, ["debug"]);
  assertEquals(code, 1);
  // The compose wrapper reports the invocation it resolved rather than the
  // binary behind it, so the assertion is on the failure, not on the name.
  assertStringIncludes(err, "Tool not found");
  assertEquals(out.includes("started"), false);
});
