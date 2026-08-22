// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a real build printing the Zuke logo and constructing the
 * star-flow commands through the CLI `main()` path — the same composition
 * `zuke setup`'s epilogue uses (`ConsoleTasks.logo`, `GhTasks.api`,
 * `BrowserTasks.open`), proving the pieces work inside an executing target,
 * not just in isolation.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { runCli } from "./_harness.ts";
import { BrowserOpenSettings, Build, target } from "../../packages/core/mod.ts";
import { ConsoleTasks, ZUKE_LOGO } from "../../packages/console/mod.ts";
import { GhApiSettings } from "../../packages/gh/mod.ts";

Deno.test("a build target prints the logo and shapes the star commands", async () => {
  const seen: string[] = [];
  const argvs: string[][] = [];

  class LogoBuild extends Build {
    splash = target()
      .description("print the logo and derive the star argvs")
      .executes(() => {
        ConsoleTasks.configure({
          sink: {
            out: (line) => seen.push(line),
            err: (line) => seen.push(line),
          },
          color: false,
        });
        ConsoleTasks.logo({ tagline: "integration" });
        ConsoleTasks.reset();
        argvs.push(
          new GhApiSettings("user/starred/zuke-build/zuke")
            .method("PUT")
            .silent()
            .argv(),
        );
        const open = new BrowserOpenSettings(
          "https://github.com/zuke-build/zuke",
        );
        open.os_ = "linux";
        argvs.push(open.argv());
      });
  }

  const { code } = await runCli(LogoBuild, ["splash"]);
  assertEquals(code, 0);
  assertEquals(seen, [...ZUKE_LOGO.split("\n"), "integration"]);
  assertEquals(argvs, [
    [
      "gh",
      "api",
      "user/starred/zuke-build/zuke",
      "--method",
      "PUT",
      "--silent",
    ],
    ["xdg-open", "https://github.com/zuke-build/zuke"],
  ]);
  assertStringIncludes(ZUKE_LOGO, "█");
});
