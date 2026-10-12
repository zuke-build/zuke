// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `@zuke/homebrew`: a real build, driven through the
 * CLI `main()`, renders a formula in one target and verifies it in the next —
 * against a fake `brew` found on `PATH` the way the real one would be, with no
 * `.toolPath(...)`.
 *
 * The fake is a POSIX shim that runs a TypeScript stand-in with the running
 * `deno` (`Deno.execPath()`), so the test needs nothing else installed. It is
 * skipped on Windows, where Homebrew does not run either.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { withEnv } from "../../packages/core/tests/_env.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { BrewTasks, HomebrewTasks } from "../../packages/homebrew/mod.ts";
import {
  FAKE_BREW_UNSUPPORTED,
  fakeBrew,
} from "../../packages/homebrew/tests/_fake_brew.ts";
import { runCli } from "./_harness.ts";

Deno.test({
  name:
    "homebrew: a build renders a formula, then verifies it with brew from PATH",
  ignore: FAKE_BREW_UNSUPPORTED,
  async fn() {
    const brew = fakeBrew();
    const dir = Deno.makeTempDirSync({ prefix: "zuke-homebrew-it-" });
    const file = `${dir}/app.rb`;
    const ran: string[] = [];
    let installed: string[] = [];

    class Release extends Build {
      formula = target().description("render the formula").executes(
        async () => {
          ran.push("formula");
          await Deno.writeTextFile(
            file,
            HomebrewTasks.formula((s) =>
              s.name("app").description("Widget tool").homepage(
                "https://example.com",
              ).version("1.2.3").license("MIT")
                .binary((b) =>
                  b.os("linux").arch("intel").url("https://example.com/a.tgz")
                    .sha256("0".repeat(64))
                )
                .install("app")
                .test((t) => t.command("--version").expectVersion())
            ),
          );
        },
      );
      verify = target().description("install, test and uninstall it")
        .dependsOn(this.formula)
        .executes(async () => {
          ran.push("verify");
          await HomebrewTasks.verify((s) => s.formulaFile(file).name("app"));
          const info = await BrewTasks.info((s) => s.formulae("app"));
          installed = info.formulae.flatMap((formula) => formula.installed);
        });
    }

    try {
      await withEnv(
        { ...brew.env, PATH: `${brew.binDir}:${Deno.env.get("PATH") ?? ""}` },
        async () => {
          const result = await runCli(Release, ["verify"]);
          assertEquals(result.code, 0, result.err);
        },
      );
      assertEquals(ran, ["formula", "verify"]);
      assertEquals(installed, ["1.2.3"]);
      const verbs = brew.calls().map((call) => call.args[0]);
      assertEquals(verbs, [
        "tap-new",
        "--repository",
        "install",
        "test",
        "uninstall",
        "untap",
        "info",
      ]);
      const tap = brew.calls()[0].args[2];
      const copied = Deno.readTextFileSync(
        `${brew.root}/${tap}/Formula/app.rb`,
      );
      assertEquals(copied, Deno.readTextFileSync(file));
      assertEquals(copied.startsWith("class App < Formula\n"), true);
    } finally {
      brew.dispose();
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "homebrew: a failing verification fails the build and still cleans up",
  ignore: FAKE_BREW_UNSUPPORTED,
  async fn() {
    const brew = fakeBrew(["test"]);
    const dir = Deno.makeTempDirSync({ prefix: "zuke-homebrew-it-" });
    const file = `${dir}/app.rb`;
    Deno.writeTextFileSync(file, "class App < Formula\nend\n");

    class Release extends Build {
      verify = target().executes(() =>
        HomebrewTasks.verify((s) => s.formulaFile(file).name("app"))
      );
    }

    try {
      await withEnv(
        { ...brew.env, PATH: `${brew.binDir}:${Deno.env.get("PATH") ?? ""}` },
        async () => {
          const result = await runCli(Release, ["verify"]);
          assertEquals(result.code, 1);
        },
      );
      const verbs = brew.calls().map((call) => call.args[0]);
      assertEquals(verbs.slice(-2), ["uninstall", "untap"]);
    } finally {
      brew.dispose();
      Deno.removeSync(dir, { recursive: true });
    }
  },
});
