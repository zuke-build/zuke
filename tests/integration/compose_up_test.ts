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
class StackBuild extends Build {
  stack = target()
    .description("start the whole stack, dependencies and all")
    .dryRunnable()
    .executes(async () => {
      await DockerComposeTasks.up((s) =>
        s.file("base.yml").services("api").build()
      );
    });
}

class DebugBuild extends Build {
  debug = target()
    .description("start one service without touching its dependencies")
    // Under `--dry-run` the body runs with the command in echo mode, so the
    // resolved argv is printed instead of spawned: the seam that shows the
    // option reaching the real command line without needing docker.
    .dryRunnable()
    .executes(async () => {
      await DockerComposeTasks.up((s) =>
        s.file("base.yml").services("api").build().noDeps()
      );
      console.log("started");
    });
}

// The same call with no docker on PATH: the option must not change how that
// failure is reported.
class MissingToolBuild extends Build {
  debug = target()
    .description("start one service without touching its dependencies")
    .executes(async () => {
      await DockerComposeTasks.up((s) =>
        missingTool(s.file("base.yml").services("api").build().noDeps())
      );
      console.log("started");
    });
}

Deno.test("the option reaches the command line a build actually runs", async () => {
  const { code, out } = await runCli(DebugBuild, ["debug", "--dry-run"]);
  assertEquals(code, 0, out);
  // The whole command, in order: the flag lands among the up options and
  // before the service, which is where compose expects it.
  assertStringIncludes(out, "compose -f base.yml up --build --no-deps api");
});

Deno.test("a build that did not ask for it gets the argv it always had", async () => {
  const { code, out } = await runCli(StackBuild, ["stack", "--dry-run"]);
  assertEquals(code, 0, out);
  assertStringIncludes(out, "compose -f base.yml up --build api");
  assertEquals(out.includes("--no-deps"), false, out);
});

Deno.test("a missing docker fails the target rather than skipping the option", async () => {
  const { code, out, err } = await runCli(MissingToolBuild, ["debug"]);
  assertEquals(code, 1);
  // The compose wrapper reports the invocation it resolved rather than the
  // binary behind it, so the assertion is on the failure, not on the name.
  assertStringIncludes(err, "Tool not found");
  assertEquals(out.includes("started"), false);
});
