// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: the bash Node launcher, run for real against a fake `node` and a
 * fake `npm` on `PATH` (no network, no real Node). It must run the build with
 * the node it finds, and install dependencies with `npm ci --ignore-scripts`
 * when `package-lock.json` is newer than `node_modules`.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { nodeLauncherBash } from "../../packages/cli/src/node_launcher.ts";
import { NODE_PIN } from "../../packages/cli/src/node_pin.ts";

/** Writes an executable shell script. */
async function script(path: string, body: string): Promise<void> {
  await Deno.writeTextFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

Deno.test({
  name: "the node launcher runs the build and npm ci with the node it finds",
  ignore: Deno.build.os === "windows",
  async fn() {
    const root = await Deno.makeTempDir();
    try {
      const bin = `${root}/bin`;
      await Deno.mkdir(bin);
      await Deno.mkdir(`${root}/project/node_modules`, { recursive: true });
      const log = `${root}/log`;
      await script(
        `${bin}/node`,
        `if [ "$1" = "--version" ]; then echo v${NODE_PIN.version}; exit 0; fi\necho "node $*" >> "${log}"`,
      );
      await script(`${bin}/npm`, `echo "npm $*" >> "${log}"`);
      await Deno.writeTextFile(`${root}/project/build.ts`, "");
      await Deno.writeTextFile(`${root}/project/package.json`, "{}");
      // cspell:ignore utime
      // Make the lockfile strictly newer than node_modules.
      await Deno.writeTextFile(`${root}/project/package-lock.json`, "{}");
      await Deno.utime(
        `${root}/project/node_modules`,
        new Date(Date.now() - 60_000),
        new Date(Date.now() - 60_000),
      );
      const launcher = `${root}/project/zuke`;
      await Deno.writeTextFile(
        launcher,
        nodeLauncherBash({ buildFile: "build.ts" }),
        { mode: 0o755 },
      );

      const { code, stderr } = await new Deno.Command(launcher, {
        args: ["lint", "--plain"],
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root },
        clearEnv: true,
        stdout: "null",
        stderr: "piped",
      }).output();
      assertEquals(code, 0, new TextDecoder().decode(stderr));
      assertEquals(
        (await Deno.readTextFile(log)).trim().split("\n"),
        ["npm ci --ignore-scripts", "node build.ts lint --plain"],
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
