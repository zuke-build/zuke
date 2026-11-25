// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: npx-style `node_modules/.bin` tool resolution driven through a
 * real build. A target runs a `defineTool` wrapper with `.fromNodeModules()`;
 * the only copy of the binary lives under a planted `node_modules/.bin`, so a
 * successful run proves the walk resolved it (it is not on `PATH`). Skipped on
 * Windows, where a bare-named copy of the Deno binary is not directly
 * spawnable — the resolution logic itself is unit-covered on every platform.
 */

import { test } from "../_testing.ts";
import { assertEquals } from "../_assert.ts";
import {
  Build,
  FileTasks,
  RuntimeTasks,
  target,
} from "../../packages/core/mod.ts";
import { defineTool } from "../../packages/core/src/tooling.ts";
import { runCli } from "./_harness.ts";
import { EVAL } from "../_eval.ts";

/** Copy the running Deno binary to `node_modules/.bin/<name>`, executable. */
async function plantLocalDeno(dir: string, name: string): Promise<void> {
  const bin = `${dir}/node_modules/.bin/${name}`;
  await FileTasks.createDirectory(`${dir}/node_modules/.bin`);
  await FileTasks.copy(RuntimeTasks.execPath(), bin);
  await FileTasks.chmod(bin, 0o755);
}

test({
  name: "a build resolves a wrapper's binary from node_modules/.bin",
  ignore: RuntimeTasks.os() === "windows",
  fn: async () => {
    const dir = await FileTasks.makeTempDirectory((s) =>
      s.prefix("zuke-it-node-bin-")
    );
    const prev = RuntimeTasks.cwd();
    try {
      await plantLocalDeno(dir, "local-deno");
      RuntimeTasks.chdir(dir);
      // `local-deno` is not on PATH: the run only succeeds via node_modules.
      const localDeno = defineTool("local-deno");
      class ToolBuild extends Build {
        run = target().executes(async () => {
          await localDeno((s) =>
            s.fromNodeModules().quiet().arg(EVAL).arg(
              "console.log('from-local')",
            )
          );
        });
      }
      const { code } = await runCli(ToolBuild, ["run"]);
      assertEquals(code, 0);
    } finally {
      RuntimeTasks.chdir(prev);
      await FileTasks.remove(dir, { recursive: true });
    }
  },
});
