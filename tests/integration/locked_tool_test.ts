import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { DenoTasks } from "../../packages/deno/mod.ts";
import { installCli } from "../../build/publish.ts";
import { runCli } from "./_harness.ts";

/**
 * The build provisions its npm-only CLIs (cspell, release-please) through
 * `deno run --frozen`, so their transitive npm trees resolve against the
 * committed `deno.lock` instead of being re-resolved on every run. These tests
 * drive that end to end: a real build target runs a real `deno run --frozen`
 * subprocess, and the generated launcher is inspected as it would be spawned.
 * Both stay hermetic — the script is local, so nothing is fetched.
 */

let scriptPath = "";
let launcher = "";

class FrozenBuild extends Build {
  /** Runs a local script with `--frozen`, the flag the tool launchers rely on. */
  frozenRun = target()
    .description("run a script with a frozen lockfile")
    .executes(async () => {
      const out = await DenoTasks.run((s) =>
        s.frozen().script(scriptPath).quiet()
      );
      console.log(`frozen-run=${out.code}`);
    });

  /** Provisions a CLI launcher the way `spell` and `release` do. */
  provision = target()
    .description("write a lock-verified tool launcher")
    .executes(async () => {
      launcher = String(
        await installCli(
          "npm:cspell@9",
          "cspell-frozen-test",
          (s) => s.allow("read"),
        ),
      );
      console.log(`launcher=${launcher}`);
    });
}

Deno.test("a build runs `deno run --frozen` end-to-end through the CLI", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-frozen-" });
  scriptPath = `${dir}/ok.ts`;
  try {
    await Deno.writeTextFile(scriptPath, 'console.log("ok");\n');
    const { code, out, err } = await runCli(FrozenBuild, ["frozenRun"]);
    assertEquals(code, 0, `--frozen must be a flag real deno accepts: ${err}`);
    assertEquals(out.includes("frozen-run=0"), true, out);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a provisioned CLI launcher resolves through the workspace lock", async () => {
  // `deno install --global` ignores the workspace lock entirely (it resolves
  // into a throwaway lockfile under its own install root), so a launcher that
  // shells out to `deno run --frozen` from the repository root is what actually
  // pins the tool's npm tree. Assert the generated launcher does that.
  const { code, err } = await runCli(FrozenBuild, ["provision"]);
  assertEquals(code, 0, err);
  try {
    const script = await Deno.readTextFile(launcher);
    assertEquals(script.includes("--frozen"), true, script);
    assertEquals(script.includes("npm:cspell@9"), true, script);
    assertEquals(script.includes("--allow-read"), true, script);
    if (Deno.build.os !== "windows") {
      assertEquals(script.startsWith("#!/bin/sh"), true, script);
      // Executable, or a tool path cannot spawn it.
      assertEquals(((await Deno.stat(launcher)).mode ?? 0o755) & 0o100, 0o100);
    }
  } finally {
    await Deno.remove(launcher);
  }
});
