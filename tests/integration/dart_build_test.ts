// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `@zuke/dart`: a real build, driven through the CLI
 * `main()` entry point, that resolves dependencies, analyzes and dry-runs a
 * publish in dependency order — and fails the run when `dart` does.
 *
 * Hermetic per AGENTS.md guideline 5: the "dart" is the running `deno`. Deno 2
 * runs `deno <file> <args…>` as a script, so a wrapper pointed at
 * `Deno.execPath()` from a directory holding scripts named after the
 * subcommands (`pub`, `analyze`) spawns them with the wrapper's real argv,
 * which each prints back. The subcommands `dart` shares with `deno` (`run`,
 * `test`, `compile`, `doc`, `fmt`) cannot be faked this way.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { DartTasks } from "../../packages/dart/mod.ts";
import { runCli } from "./_harness.ts";

/** A fake subcommand script: prints its argv as JSON, then exits with `code`. */
function fake(code: number): string {
  return `console.log(JSON.stringify(Deno.args)); Deno.exit(${code});`;
}

/** A Dart package's build, recording each `dart` call's argv into `calls`. */
function packageBuild(dir: string, calls: string[][]) {
  const record = (stdout: string) => calls.push(JSON.parse(stdout));
  return class Package extends Build {
    deps = target().executes(async () => {
      const out = await DartTasks.pubGet((s) =>
        s.toolPath(Deno.execPath()).cwd(dir).quiet().enforceLockfile()
      );
      record(out.stdout);
    });
    check = target().dependsOn(this.deps).executes(async () => {
      const out = await DartTasks.analyze((s) =>
        s.toolPath(Deno.execPath()).cwd(dir).quiet().fatalInfos().path("lib")
      );
      record(out.stdout);
    });
    publish = target().dependsOn(this.check).executes(async () => {
      const out = await DartTasks.pubPublish((s) =>
        s.toolPath(Deno.execPath()).cwd(dir).quiet().dryRun()
      );
      record(out.stdout);
    });
  };
}

/** Run the package build against fake `pub` and `analyze` scripts. */
async function runBuild(
  analyzeCode: number,
): Promise<{ code: number; calls: string[][] }> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-dart-" });
  try {
    await Deno.writeTextFile(`${dir}/pub`, fake(0));
    await Deno.writeTextFile(`${dir}/analyze`, fake(analyzeCode));
    const calls: string[][] = [];
    const { code } = await runCli(packageBuild(dir, calls), ["publish"]);
    return { code, calls };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("dart: a build runs pub get, analyze, then the publish dry run", async () => {
  const { code, calls } = await runBuild(0);
  assertEquals(code, 0);
  assertEquals(calls, [
    ["get", "--enforce-lockfile"],
    ["--fatal-infos", "lib"],
    ["publish", "--dry-run"],
  ]);
});

Deno.test("dart: a failing analyze fails the run before publish", async () => {
  const { code, calls } = await runBuild(1);
  assertEquals(code, 1);
  // The wrapper threw on the non-zero exit, so publish never ran.
  assertEquals(calls, [["get", "--enforce-lockfile"]]);
});
