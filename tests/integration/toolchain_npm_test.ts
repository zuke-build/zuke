import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target, toolchain } from "../../packages/core/mod.ts";
import type { NpmRunner } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

// A build that provisions an npm-package tool. The fake npm runner and the
// install root are module-scoped so the target's body (captured at field-init)
// reads them at execution time — set before each run.
let npmCalls: string[][] = [];
let toolsDir = "";

/** Plants the expected bin under `--prefix`, recording argv — no real npm. */
const fakeNpm: NpmRunner = async (args) => {
  npmCalls.push(args);
  const prefix = args[args.indexOf("--prefix") + 1];
  await Deno.mkdir(`${prefix}/node_modules/.bin`, { recursive: true });
  const exe = Deno.build.os === "windows" ? ".cmd" : "";
  await Deno.writeTextFile(`${prefix}/node_modules/.bin/vitest${exe}`, "x");
};

class ProvisionBuild extends Build {
  tools = toolchain((t) => t.npm({ name: "vitest", version: "4.1.9" }));

  provision = target()
    .description("provision an npm-package tool")
    .executes(async () => {
      const bins = await this.tools.install({
        destDir: toolsDir,
        npmRun: fakeNpm,
      });
      console.log(`vitest=${bins.get("vitest")}`);
    });
}

Deno.test("a build provisions an npm-package tool end-to-end via the CLI", async () => {
  npmCalls = [];
  toolsDir = await Deno.makeTempDir({ prefix: "zuke-npm-it-" });
  try {
    const { code, out } = await runCli(ProvisionBuild, ["provision"]);
    assertEquals(code, 0);
    assertStringIncludes(out, "/npm/vitest@4.1.9/node_modules/.bin/vitest");
    assertEquals(npmCalls.length, 1);
    assertEquals(npmCalls[0][4], "vitest@4.1.9");
  } finally {
    await Deno.remove(toolsDir, { recursive: true });
  }
});

Deno.test("re-provisioning the same pin reuses the cache (npm runs once)", async () => {
  npmCalls = [];
  toolsDir = await Deno.makeTempDir({ prefix: "zuke-npm-it-" });
  try {
    await runCli(ProvisionBuild, ["provision"]);
    await runCli(ProvisionBuild, ["provision"]); // second run hits the marker
    assertEquals(npmCalls.length, 1);
  } finally {
    await Deno.remove(toolsDir, { recursive: true });
  }
});
