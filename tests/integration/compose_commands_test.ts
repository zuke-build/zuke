// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the broadened `@zuke/docker-compose` surface driven from a real
 * build through the CLI `main()`. The unit tests assert argv; this proves the
 * tasks work as a target's body — that the value-returning ones fail the build
 * when Compose is missing rather than handing back a confident number, and
 * that a settings class's own refusal surfaces as a failed target.
 *
 * Hermetic by construction: Compose is an ambient tool, so every target here
 * drives the missing-binary path rather than a real daemon.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import {
  DockerComposeTasks,
  resetComposeInvocationCache_,
  resolveComposeInvocation,
} from "../../packages/docker-compose/mod.ts";
import { runCli } from "./_harness.ts";

/**
 * Seed the Compose invocation cache from a fake probe so detection never
 * touches the host.
 *
 * Without this the wrapper probes for a real Docker before it builds any
 * argv, so on a machine without one every target here fails with "not found"
 * rather than with the refusal or reader behaviour under test — which is
 * exactly what happened on the macOS runner, where Docker is absent.
 */
async function withDetectedCompose(body: () => Promise<void>): Promise<void> {
  resetComposeInvocationCache_();
  await resolveComposeInvocation((argv) =>
    Promise.resolve(argv[0] === "docker-compose")
  );
  try {
    await body();
  } finally {
    resetComposeInvocationCache_();
  }
}

class ReaderBuild extends Build {
  testExit = target()
    .description("take the containerised suite's exit status as the verdict")
    .executes(async () => {
      const code = await DockerComposeTasks.waitExitCode((s) =>
        missingTool(s).services("tests")
      );
      console.log(`exit=${code}`);
    });

  dbPort = target()
    .description("ask which host port the database was published on")
    .executes(async () => {
      const port = await DockerComposeTasks.servicePort((s) =>
        missingTool(s).service("db").privatePort(5432)
      );
      console.log(`port=${port}`);
    });
}

class RefusalBuild extends Build {
  copyBetweenServices = target()
    .description("a copy with a service at both ends")
    .executes(async () => {
      await DockerComposeTasks.cp((s) =>
        missingTool(s).fromService("a", "/x").toService("b", "/y")
      );
    });

  waitWithoutServices = target()
    .description("a wait that names no service to wait on")
    .executes(async () => {
      await DockerComposeTasks.wait((s) => missingTool(s));
    });

  scaleWithoutServices = target()
    .description("a scale that names nothing to scale")
    .executes(async () => {
      await DockerComposeTasks.scale((s) => missingTool(s));
    });
}

Deno.test("a missing Compose fails the build rather than yielding a number", async () => {
  // The point of the guard: waitExitCode runs with noThrow so a container's
  // non-zero status can come back as data, which must not also swallow "there
  // is no Compose here".
  await withDetectedCompose(async () => {
    const exit = await runCli(ReaderBuild, ["testExit"]);
    assertEquals(exit.code, 1);
    assertEquals(exit.out.includes("exit="), false);

    const port = await runCli(ReaderBuild, ["dbPort"]);
    assertEquals(port.code, 1);
    assertEquals(port.out.includes("port="), false);
  });
});

Deno.test("a settings refusal fails the target, and says how to fix it", async () => {
  await withDetectedCompose(async () => {
    const cp = await runCli(RefusalBuild, ["copyBetweenServices"]);
    assertEquals(cp.code, 1);
    assertStringIncludes(cp.err, "two services");

    const wait = await runCli(RefusalBuild, ["waitWithoutServices"]);
    assertEquals(wait.code, 1);
    assertStringIncludes(wait.err, ".services()");

    const scale = await runCli(RefusalBuild, ["scaleWithoutServices"]);
    assertEquals(scale.code, 1);
    assertStringIncludes(scale.err, ".scale(service, replicas)");
  });
});
