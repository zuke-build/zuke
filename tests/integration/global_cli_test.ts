// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the global `zuke` command forwarding a build command to the
 * project's own `zuke.ts`. Drives `@zuke/cli`'s real `main()` with its real
 * subprocess runner against a scratch project — a `zuke.json` marking the root
 * and a `zuke.ts` that imports `@zuke/core` from this checkout by file URL, so
 * nothing touches the network — and proves the whole path: the walk up from a
 * subdirectory, the spawn from the root, the target executing, and the exit
 * code coming back.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { CONFIG_FILE } from "../../packages/core/src/config.ts";
import { main } from "../../packages/cli/mod.ts";
import { defaultHost, type SetupHost } from "../../packages/cli/src/setup.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";

/**
 * The real, filesystem-probing host — the walk up to `zuke.json` must see the
 * scratch project — with its progress lines captured instead of printed.
 * `defaultHost` is a plain object literal, so spreading it keeps every method.
 */
function recordingHost(): SetupHost & { logs: string[] } {
  const logs: string[] = [];
  return { ...defaultHost, logs, log: (line) => void logs.push(line) };
}

/** This checkout's `@zuke/core` entry point, as an import the scratch build can use. */
const CORE = new URL("../../packages/core/mod.ts", import.meta.url).href;

/** A build with one target that records its run and one that fails. */
function scratchBuild(): string {
  return `import { Build, run, target } from "${CORE}";

class Scratch extends Build {
  hello = target()
    .description("Write a marker so the test can see the target ran")
    .executes(async () => {
      await Deno.writeTextFile("ran.txt", Deno.cwd());
    });
  broken = target()
    .description("Fail on purpose")
    .executes(() => {
      throw new Error("broken on purpose");
    });
}

await run(Scratch);
`;
}

/** Run `fn` with the process cwd set to `dir`, restoring it afterwards. */
async function inDir(dir: string, fn: () => Promise<void>): Promise<void> {
  const prev = Deno.cwd();
  Deno.chdir(dir);
  try {
    await fn();
  } finally {
    Deno.chdir(prev);
  }
}

Deno.test("zuke <target> from a subdirectory runs the build at the project root", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/${CONFIG_FILE}`,
      '{ "name": "Scratch" }\n',
    );
    await Deno.writeTextFile(`${dir}/zuke.ts`, scratchBuild());
    await Deno.mkdir(`${dir}/src/deep`, { recursive: true });
    // The CLI's own stdout is captured so it can be asserted empty; the build
    // itself runs through the real runner with inherited stdio.
    const host = recordingHost();
    await inDir(`${dir}/src/deep`, async () => {
      const code = await main(["hello"], host);
      assertEquals(code, 0);
    });
    // The target executed, from the root (not the subdirectory it was invoked
    // in), so its relative write landed beside zuke.ts.
    const cwd = await Deno.readTextFile(`${dir}/ran.txt`);
    assertEquals(await Deno.realPath(cwd), await Deno.realPath(dir));
    assertEquals(host.logs, []);
  }, { prefix: "zuke-global-cli-" });
});

Deno.test("zuke <target> propagates a failing target's exit code", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/${CONFIG_FILE}`,
      '{ "name": "Scratch" }\n',
    );
    await Deno.writeTextFile(`${dir}/zuke.ts`, scratchBuild());
    await inDir(dir, async () => {
      assertEquals(await main(["broken"], recordingHost()), 1);
      // The build's own CLI answers for a typo — the global CLI never treats
      // it as one of its unknown commands once a zuke.json is in reach.
      // cspell:ignore helo
      const host = recordingHost();
      assertEquals(await main(["helo"], host), 1);
      assertEquals(host.logs, []);
    });
  }, { prefix: "zuke-global-cli-" });
});

Deno.test("zuke <target> outside any project is an unknown command, not a spawn", async () => {
  await withTemp(async (dir) => {
    // No zuke.json anywhere up from a bare temp dir (the walk ends at the
    // filesystem root, which the suite never marks).
    await inDir(dir, async () => {
      const host = recordingHost();
      assertEquals(await main(["hello"], host), 1);
      assertEquals(host.logs[0].includes("no zuke.json was found"), true);
    });
  }, { prefix: "zuke-global-cli-" });
});
