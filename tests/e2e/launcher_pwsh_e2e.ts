// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: the PowerShell Deno launcher, run for real by Windows
 * PowerShell with `-File`, as a script or a CI step runs it. Its notices must
 * reach stderr: PowerShell renders the warning stream on stdout for such a
 * caller, and stdout is the build's own (`--list --json`, `mcp`).
 */

import { test } from "../_testing.ts";
import { assertEquals } from "../_assert.ts";
import { withTemp } from "../_temp.ts";
import { launcherPwsh } from "../../packages/cli/src/launcher.ts";
import { DENO_SUPPORT_NOTICE } from "../../packages/cli/src/dispatch.ts";

const WINDOWS = Deno.build.os === "windows";
const SYSTEM = Deno.env.get("SystemRoot") ?? "C:\\Windows";
// Windows PowerShell's own modules: a PSModulePath inherited from pwsh 7 (the
// runner's shell) hides built-ins from it.
const MODULES = `${SYSTEM}\\System32\\WindowsPowerShell\\v1.0\\Modules`;

test({
  name: "the powershell deno launcher keeps its notices off the build's stdout",
  ignore: !WINDOWS,
  async fn() {
    await withTemp(async (root) => {
      // The plain launcher, with the running deno as the one on PATH.
      const bin = `${root}\\bin`;
      await Deno.mkdir(bin);
      await Deno.copyFile(Deno.execPath(), `${bin}\\deno.exe`);
      await Deno.writeTextFile(
        `${root}\\build.ts`,
        "console.log(JSON.stringify({ args: Deno.args }));\n",
      );
      await Deno.writeTextFile(
        `${root}\\zuke.ps1`,
        launcherPwsh({ bootstrapDeno: false, buildFile: "build.ts" }),
      );
      const out = await new Deno.Command("powershell.exe", {
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          `${root}\\zuke.ps1`,
          "--list",
          "--json",
        ],
        cwd: root,
        env: {
          PATH:
            `${bin};${SYSTEM}\\System32;${SYSTEM}\\System32\\WindowsPowerShell\\v1.0`,
          PSModulePath: MODULES,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const text = new TextDecoder();
      const stdout = text.decode(out.stdout);
      const stderr = text.decode(out.stderr);
      assertEquals(out.code, 0, stderr);
      // Only the build's JSON, which parses.
      assertEquals(JSON.parse(stdout), { args: ["--list", "--json"] });
      // Both notices, on stderr: the support line, and no deno.lock yet.
      assertEquals(
        stderr.includes(DENO_SUPPORT_NOTICE.replace("—", "-")),
        true,
        stderr,
      );
      assertEquals(stderr.includes("no deno.lock here yet"), true, stderr);
    });
  },
});
