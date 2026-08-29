// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the broadened `@zuke/deno` surface driven from a real build
 * through the CLI `main()`. The unit tests assert argv; this proves the tasks
 * work as a target's body — that the module-graph reader hands a build real
 * data it can gate on, and that a settings class's own refusal surfaces as a
 * failed target rather than a silently wrong command line.
 *
 * The reader target runs the deno already executing the suite
 * (`Deno.execPath()`, the wrapper's default) against a committed fixture that
 * imports nothing, so it stays hermetic: no network, no ambient tool. The
 * fixture is addressed by `file://` URL, which is byte-identical on every OS
 * — an interpolated path is not, and that is what made an earlier version of
 * this test read a not-found module on Windows.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { missingTool } from "../../packages/core/src/tooling_conformance.ts";
import { DenoTasks } from "../../packages/deno/mod.ts";
import { runCli } from "./_harness.ts";

/** The import-free fixture whose graph the reader target reports on. */
const FIXTURE = new URL(
  "../../packages/deno/tests/fixtures/self_contained.ts",
  import.meta.url,
).href;

class GraphBuild extends Build {
  entry = parameter("the module to build a graph for").required();

  reportGraph = target()
    .description("report what the entrypoint pulls in")
    .executes(async () => {
      const graph = await DenoTasks.moduleGraph((s) =>
        s.path(this.entry.value)
      );
      console.log(`modules=${graph.modules.length}`);
      // Reported before the media type: a module deno could not load carries
      // an error and none of the rest, so this says why rather than just what.
      console.log(`error=${graph.modules[0]?.error}`);
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
  const result = await runCli(GraphBuild, [
    "reportGraph",
    `--entry=${FIXTURE}`,
  ]);
  assertEquals(result.code, 0);
  assertStringIncludes(result.out, "modules=1");
  assertStringIncludes(result.out, "error=undefined");
  assertStringIncludes(result.out, "media=TypeScript");
});

Deno.test("the cache reader runs without a module operand", async () => {
  const result = await runCli(GraphBuild, ["caches", `--entry=${FIXTURE}`]);
  assertEquals(result.code, 0);
  assertStringIncludes(result.out, "hasDenoDir=true");
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
