// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the broadened `@zuke/docker` surface driven from a real build
 * through the CLI `main()`. The unit tests assert argv; this proves the tasks
 * are reachable as a target's body — that a value-returning one fails the
 * build when docker is missing rather than reporting an empty daemon, and
 * that a settings class's own validation surfaces as a failed target.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { DockerTasks } from "../../packages/docker/mod.ts";
import { runCli } from "./_harness.ts";

class ServicesBuild extends Build {
  running = target()
    .description("report the containers this build started")
    .executes(async () => {
      const entries = await DockerTasks.psEntries((s) => missingTool(s).all());
      console.log(`running=${entries.length}`);
    });

  collect = target()
    .description("recover a report from a container that has exited")
    .executes(async () => {
      await DockerTasks.cp((s) =>
        missingTool(s).from("tests:/out/report.xml").to("reports/")
      );
      console.log("collected");
    });

  result = target()
    .description("wait for the test container's exit code")
    .executes(async () => {
      await DockerTasks.wait((s) => missingTool(s).containers("tests"));
      console.log("waited");
    });

  isolate = target()
    .description("create the network the services share")
    .executes(async () => {
      await DockerTasks.network((s) => missingTool(s).create("test-net"));
      console.log("networked");
    });

  reclaim = target()
    .description("reclaim disk before the next build")
    .executes(async () => {
      await DockerTasks.system((s) => missingTool(s).prune().all().force());
      console.log("reclaimed");
    });

  mistake = target()
    .description("a prune flag on a command that does not prune")
    .executes(async () => {
      // The settings refuse this before docker is ever spawned: dropping the
      // flag would silently run a report instead of the prune asked for.
      await DockerTasks.system((s) => missingTool(s).df().all());
      console.log("pruned");
    });
}

const FAILS_ON_MISSING_DOCKER: Array<[string, string]> = [
  ["running", "running="],
  ["collect", "collected"],
  ["result", "waited"],
  ["isolate", "networked"],
  ["reclaim", "reclaimed"],
];

for (const [name, marker] of FAILS_ON_MISSING_DOCKER) {
  Deno.test(`the ${name} target fails with the tool-not-found error`, async () => {
    const { code, out, err } = await runCli(ServicesBuild, [name]);
    assertEquals(code, 1);
    assertStringIncludes(err, "zuke-no-such-tool-xyz");
    assertEquals(out.includes(marker), false);
  });
}

Deno.test("a settings validation failure fails the target, naming the fix", async () => {
  const { code, out, err } = await runCli(ServicesBuild, ["mistake"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "describe a prune");
  assertEquals(out.includes("pruned"), false);
});
