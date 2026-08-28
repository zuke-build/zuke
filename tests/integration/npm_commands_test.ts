// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the broadened `@zuke/npm` surface driven from a real build
 * through the CLI `main()`. The unit tests assert argv; this proves the tasks
 * are reachable as a target's body — that a value-returning one fails the
 * build when npm is missing rather than reporting a clean audit from empty
 * output, and that a settings class's own validation surfaces as a failed
 * target rather than being swallowed by the executor.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { NpmTasks } from "../../packages/npm/mod.ts";
import { runCli } from "./_harness.ts";

class ReleaseBuild extends Build {
  vulnerabilities = target()
    .description("fail the build on a high-severity advisory")
    .executes(async () => {
      const audit = await NpmTasks.auditSummary((s) =>
        missingTool(s).omit("dev")
      );
      console.log(`high=${audit.high}`);
    });

  stale = target()
    .description("report the dependencies behind their latest")
    .executes(async () => {
      const entries = await NpmTasks.outdatedEntries((s) => missingTool(s));
      console.log(`stale=${entries.length}`);
    });

  stamp = target()
    .description("read the package's own version")
    .executes(async () => {
      const version = await NpmTasks.pkgGet("version", (s) => missingTool(s));
      console.log(`version=${version}`);
    });

  tarball = target()
    .description("pack a tarball for the release")
    .executes(async () => {
      await NpmTasks.pack((s) => missingTool(s).packDestination("dist"));
      console.log("packed");
    });

  promote = target()
    .description("point the latest dist-tag at the new version")
    .executes(async () => {
      await NpmTasks.distTag((s) => missingTool(s).add("app@1.2.3", "latest"));
      console.log("promoted");
    });

  wipe = target()
    .description("a cache clean that never says it means it")
    .executes(async () => {
      // No `.force()`: the settings refuse this before npm is ever spawned.
      await NpmTasks.cache((s) => missingTool(s).clean());
      console.log("cleaned");
    });
}

const FAILS_ON_MISSING_NPM: Array<[string, string]> = [
  ["vulnerabilities", "high="],
  ["stale", "stale="],
  ["stamp", "version="],
  ["tarball", "packed"],
  ["promote", "promoted"],
];

for (const [name, marker] of FAILS_ON_MISSING_NPM) {
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
  assertStringIncludes(err, "--force");
  assertEquals(out.includes("cleaned"), false);
});
