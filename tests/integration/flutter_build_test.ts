// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `@zuke/flutter`: a real build, driven through the
 * CLI `main()` entry point, that resolves dependencies, tests and builds an app
 * bundle in dependency order — and fails the run when `flutter` does.
 *
 * Hermetic per AGENTS.md guideline 5: the "flutter" is the running `deno`.
 * Deno 2 runs `deno <file> <args…>` as a script, so a wrapper pointed at
 * `Deno.execPath()` from a directory holding scripts named after the
 * subcommands (`pub`, `build`) spawns them with the wrapper's real argv, which
 * each prints back.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { FlutterTasks } from "../../packages/flutter/mod.ts";
import { runCli } from "./_harness.ts";

/** A fake subcommand script: prints its argv as JSON, then exits with `code`. */
function fake(code: number): string {
  return `console.log(JSON.stringify(Deno.args)); Deno.exit(${code});`;
}

/** A Flutter app's build, recording each `flutter` call's argv into `calls`. */
function appBuild(dir: string, calls: string[][]) {
  const record = (stdout: string) => calls.push(JSON.parse(stdout));
  return class App extends Build {
    deps = target().executes(async () => {
      const out = await FlutterTasks.pubGet((s) =>
        s.toolPath(Deno.execPath()).cwd(dir).quiet().enforceLockfile()
      );
      record(out.stdout);
    });
    bundle = target().dependsOn(this.deps).executes(async () => {
      const out = await FlutterTasks.buildAppBundle((s) =>
        s.toolPath(Deno.execPath()).cwd(dir).quiet().release()
          .flavor("prod").buildNumber(7).dartDefine("ENV", "prod")
      );
      record(out.stdout);
    });
  };
}

/** Run the app build against fake `pub` and `build` scripts in a temp dir. */
async function runApp(
  buildCode: number,
): Promise<{ code: number; calls: string[][] }> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-flutter-" });
  try {
    await Deno.writeTextFile(`${dir}/pub`, fake(0));
    await Deno.writeTextFile(`${dir}/build`, fake(buildCode));
    const calls: string[][] = [];
    const { code } = await runCli(appBuild(dir, calls), ["bundle"]);
    return { code, calls };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("flutter: a build runs pub get, then the app bundle", async () => {
  const { code, calls } = await runApp(0);
  assertEquals(code, 0);
  assertEquals(calls, [
    ["get", "--enforce-lockfile"],
    [
      "appbundle",
      "--release",
      "--dart-define=ENV=prod",
      "--flavor",
      "prod",
      "--build-number",
      "7",
    ],
  ]);
});

Deno.test("flutter: a failing flutter build fails the run", async () => {
  const { code, calls } = await runApp(1);
  assertEquals(code, 1);
  // The wrapper threw on the non-zero exit, so only pub get was recorded.
  assertEquals(calls, [["get", "--enforce-lockfile"]]);
});
