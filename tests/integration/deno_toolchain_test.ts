// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the broadened `@zuke/deno` surface driven from a real build
 * through the CLI `main()`. The unit tests assert argv; this proves the tasks
 * work as a target's body — that the module-graph reader hands a build real
 * data it can gate on, and that a settings class's own refusal surfaces as a
 * failed target rather than a silently wrong command line.
 *
 * The reader targets run the deno already executing the suite
 * (`Deno.execPath()`, the wrapper's default) against a fixture that imports
 * nothing, so they stay hermetic: no network, no ambient tool.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { DenoTasks } from "../../packages/deno/mod.ts";
import { runCli } from "./_harness.ts";

/** A fixture module with no imports, so its graph needs no network. */
async function withSelfContainedModule(
  body: (entry: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    const entry = `${dir}/mod.ts`;
    await Deno.writeTextFile(entry, "export const answer = 42;\n");
    await body(entry, dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

class GraphBuild extends Build {
  entry = parameter("the module to build a graph for").required();
  workdir = parameter("the directory deno runs in").required();

  reportGraph = target()
    .description("report what the entrypoint pulls in")
    .executes(async () => {
      const graph = await DenoTasks.moduleGraph((s) =>
        s.path(this.entry.value).cwd(this.workdir.value)
      );
      console.log(`modules=${graph.modules.length}`);
      console.log(`media=${graph.modules[0]?.mediaType}`);
    });

  caches = target()
    .description("report where the toolchain caches live")
    .executes(async () => {
      const info = await DenoTasks.cacheInfo();
      console.log(`hasDenoDir=${(info.denoDir ?? "") !== ""}`);
    });
}

class RefusalBuild extends Build {
  minifyWithoutBundle = target()
    .description("a compile that asks to minify an unbundled binary")
    .executes(async () => {
      await DenoTasks.compile((s) => missingTool(s).script("mod.ts").minify());
    });

  rootWithoutGlobal = target()
    .description("an uninstall that names a root but no global executable")
    .executes(async () => {
      await DenoTasks.uninstall((s) =>
        missingTool(s).packages("cspell").root("/opt/deno")
      );
    });

  graphWithoutModule = target()
    .description("a module-graph read with no module to read")
    .executes(async () => {
      await DenoTasks.moduleGraph((s) => missingTool(s));
    });
}

Deno.test("the module-graph reader gives a build data it can gate on", async () => {
  await withSelfContainedModule(async (entry, dir) => {
    const result = await runCli(GraphBuild, [
      "reportGraph",
      `--entry=${entry}`,
      `--workdir=${dir}`,
    ]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.out, "modules=1");
    assertStringIncludes(result.out, "media=TypeScript");
  });
});

Deno.test("the cache reader runs without a module operand", async () => {
  await withSelfContainedModule(async (entry, dir) => {
    const result = await runCli(GraphBuild, [
      "caches",
      `--entry=${entry}`,
      `--workdir=${dir}`,
    ]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.out, "hasDenoDir=true");
  });
});

Deno.test("a settings refusal fails the target, and says how to fix it", async () => {
  const minify = await runCli(RefusalBuild, ["minifyWithoutBundle"]);
  assertEquals(minify.code, 1);
  assertStringIncludes(minify.err, ".bundle()");

  const root = await runCli(RefusalBuild, ["rootWithoutGlobal"]);
  assertEquals(root.code, 1);
  assertStringIncludes(root.err, ".global()");

  const graph = await runCli(RefusalBuild, ["graphWithoutModule"]);
  assertEquals(graph.code, 1);
  assertStringIncludes(graph.err, "cacheInfo");
});
