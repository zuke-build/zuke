// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `@zuke/homebrew`: a real build, driven through the
 * CLI `main()`, renders a formula in one target and verifies it in the next —
 * against a fake `brew` found on `PATH` the way the real one would be, with no
 * `.toolPath(...)`.
 *
 * The fake is a POSIX shim that runs a TypeScript stand-in with the running
 * runtime, so the test needs nothing else installed. It is
 * skipped on Windows, where Homebrew does not run either.
 *
 * @module
 */

import { test } from "../_testing.ts";
import { assertEquals } from "../_assert.ts";
import { withEnv } from "../_env.ts";
import { makeTempDir } from "../_temp.ts";
import { Build, EnvTasks, FileTasks, target } from "../../packages/core/mod.ts";
import { BrewTasks, HomebrewTasks } from "../../packages/homebrew/mod.ts";
import {
  FAKE_BREW_UNSUPPORTED,
  fakeBrew,
} from "../support/homebrew/_fake_brew.ts";
import { runCli } from "./_harness.ts";

test({
  name:
    "homebrew: a build renders a formula, then verifies it with brew from PATH",
  ignore: FAKE_BREW_UNSUPPORTED,
  async fn() {
    const brew = fakeBrew();
    const dir = await makeTempDir({ prefix: "zuke-homebrew-it-" });
    const file = `${dir}/app.rb`;
    const ran: string[] = [];
    let installed: string[] = [];

    class Release extends Build {
      formula = target().description("render the formula").executes(
        async () => {
          ran.push("formula");
          await FileTasks.writeText(
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
        { ...brew.env, PATH: `${brew.binDir}:${EnvTasks.get("PATH") ?? ""}` },
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
        "trust",
        "--repository",
        "install",
        "test",
        "uninstall",
        "untap",
        "info",
      ]);
      const tap = brew.calls()[0].args[2];
      const copied = await FileTasks.readText(
        `${brew.root}/${tap}/Formula/app.rb`,
      );
      assertEquals(copied, await FileTasks.readText(file));
      assertEquals(copied.startsWith("class App < Formula\n"), true);
    } finally {
      brew.dispose();
      await FileTasks.remove(dir, { recursive: true });
    }
  },
});

test({
  name: "homebrew: a failing verification fails the build and still cleans up",
  ignore: FAKE_BREW_UNSUPPORTED,
  async fn() {
    const brew = fakeBrew(["test"]);
    const dir = await makeTempDir({ prefix: "zuke-homebrew-it-" });
    const file = `${dir}/app.rb`;
    await FileTasks.writeText(file, "class App < Formula\nend\n");

    class Release extends Build {
      verify = target().executes(() =>
        HomebrewTasks.verify((s) => s.formulaFile(file).name("app"))
      );
    }

    try {
      await withEnv(
        { ...brew.env, PATH: `${brew.binDir}:${EnvTasks.get("PATH") ?? ""}` },
        async () => {
          const result = await runCli(Release, ["verify"]);
          assertEquals(result.code, 1);
        },
      );
      const verbs = brew.calls().map((call) => call.args[0]);
      assertEquals(verbs.slice(-2), ["uninstall", "untap"]);
    } finally {
      brew.dispose();
      await FileTasks.remove(dir, { recursive: true });
    }
  },
});
