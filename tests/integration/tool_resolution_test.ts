/**
 * Integration: npx-style `node_modules/.bin` tool resolution driven through a
 * real build. A target runs a `defineTool` wrapper with `.fromNodeModules()`;
 * the only copy of the binary lives under a planted `node_modules/.bin`, so a
 * successful run proves the walk resolved it (it is not on `PATH`). Skipped on
 * Windows, where a bare-named copy of the Deno binary is not directly
 * spawnable — the resolution logic itself is unit-covered on every platform.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { defineTool } from "../../packages/core/src/tooling.ts";
import { runCli } from "./_harness.ts";

/** Copy the running Deno binary to `node_modules/.bin/<name>`, executable. */
function plantLocalDeno(dir: string, name: string): void {
  const binDir = `${dir}/node_modules/.bin`;
  Deno.mkdirSync(binDir, { recursive: true });
  Deno.copyFileSync(Deno.execPath(), `${binDir}/${name}`);
  Deno.chmodSync(`${binDir}/${name}`, 0o755);
}

Deno.test({
  name: "a build resolves a wrapper's binary from node_modules/.bin",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "zuke-it-node-bin-" });
    const prev = Deno.cwd();
    try {
      plantLocalDeno(dir, "local-deno");
      Deno.chdir(dir);
      // `local-deno` is not on PATH: the run only succeeds via node_modules.
      const localDeno = defineTool("local-deno");
      class ToolBuild extends Build {
        run = target().executes(async () => {
          await localDeno((s) =>
            s.fromNodeModules().quiet().arg("eval").arg(
              "console.log('from-local')",
            )
          );
        });
      }
      const { code } = await runCli(ToolBuild, ["run"]);
      assertEquals(code, 0);
    } finally {
      Deno.chdir(prev);
      await Deno.remove(dir, { recursive: true });
    }
  },
});
