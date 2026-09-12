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
import { type BuildProbe, main } from "../../packages/cli/mod.ts";
import { defaultBuildProbe } from "../../packages/cli/src/dispatch.ts";
import { defaultHost, type SetupHost } from "../../packages/cli/src/setup.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";
import { withEnv } from "../../packages/core/tests/_env.ts";

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

/**
 * The real probe, confined to `dir`: everything above it reads as absent, so
 * the walk cannot find — and the test cannot run, with `-A` — a `zuke.json`
 * that happens to sit above the temp directory on this machine.
 */
function confinedTo(dir: string): BuildProbe {
  const inside = (path: string) => path.startsWith(`${dir}/`);
  return {
    exists: (path) =>
      inside(path) ? defaultBuildProbe.exists(path) : Promise.resolve(false),
    ownership: (path) =>
      inside(path) ? defaultBuildProbe.ownership(path) : Promise.resolve(null),
    uid: () => defaultBuildProbe.uid(),
  };
}

Deno.test("zuke <target> outside any project is an unknown command, not a spawn", async () => {
  await withTemp(async (dir) => {
    // No zuke.json in the temp dir, and none reachable above it.
    await inDir(dir, async () => {
      const host = recordingHost();
      const code = await main(
        ["hello"],
        host,
        undefined,
        undefined,
        undefined,
        () => Promise.reject(new Error("must not spawn")),
        confinedTo(dir),
      );
      assertEquals(code, 1);
      assertEquals(host.logs[0].includes("no zuke.json was found"), true);
    });
  }, { prefix: "zuke-global-cli-" });
});

/**
 * The percent-encoded `::`, kept as its own constant so the encoded prefix
 * never fuses with the word after it into a token no dictionary can know.
 */
const ENC = "%3A%3A";

Deno.test("zuke <argv> cannot forge a workflow command on an Actions runner", async () => {
  // The whole path, as the binary runs it: the real host writing through the
  // package's sink, the real probe (confined to the temp dir, so there is no
  // build to forward to), and the runner's environment. The unknown-command
  // message echoed argv raw, and an argument carrying a newline put `::` at
  // the start of a physical line, which the runner executes; every physical
  // line is asserted, since the runner reads lines, not messages.
  await withTemp(async (dir) => {
    await inDir(dir, async () => {
      const out: string[] = [];
      const original = console.log;
      console.log = (...parts: unknown[]) => void out.push(parts.join(" "));
      try {
        await withEnv({ GITHUB_ACTIONS: "true" }, async () => {
          const code = await main(
            [["typo", "::stop-commands::forged"].join("\n")],
            defaultHost,
            undefined,
            undefined,
            undefined,
            () => Promise.reject(new Error("must not spawn")),
            confinedTo(dir),
          );
          assertEquals(code, 1);
        });
      } finally {
        console.log = original;
      }
      const lines = out.flatMap((l) => l.split("\n"));
      assertEquals(lines.some((l) => l.trimStart().startsWith("::")), false);
      assertEquals(
        lines.some((l) => l.startsWith(ENC + "stop-commands::forged")),
        true,
      );
    });
  }, { prefix: "zuke-global-cli-" });
});
