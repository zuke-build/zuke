// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `zuke setup --sdk python` and
 * `zuke upgrade --engine`: the real `@zuke/cli` `main()` against a real
 * temporary directory, with only the registry faked. What it proves is the
 * acceptance criterion of the slice: the scaffold is a project the `zuke`
 * command forwards to the pinned `@zuke/engine`, and the pin can be moved.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { defaultPrompter, main } from "../../packages/cli/mod.ts";
import { defaultHost, type SetupHost } from "../../packages/cli/src/setup.ts";
import { defaultBuildProbe } from "../../packages/cli/src/dispatch.ts";
import { defaultProjectHost } from "../../packages/cli/src/project.ts";
import { engineRegistry } from "../../packages/cli/tests/_fakes.ts";
import { withEnv } from "../../packages/core/tests/_env.ts";

/** Run `fn` with the process cwd set to a fresh temp dir, cleaning up after. */
async function inTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-sdk-" });
  const prev = Deno.cwd();
  Deno.chdir(dir);
  try {
    await fn(dir);
  } finally {
    Deno.chdir(prev);
    await Deno.remove(dir, { recursive: true });
  }
}

/** The production host with its log captured. */
function quietHost(lines: string[]): SetupHost {
  return { ...defaultHost, log: (message: string) => void lines.push(message) };
}

Deno.test("zuke setup --sdk python scaffolds a project the zuke command runs on the pinned engine", async () => {
  await inTempDir(async (dir) => {
    const lines: string[] = [];
    // The registry is never reached: --engine pins without it.
    const code = await main(
      [
        "setup",
        "--yes",
        "--sdk",
        "python",
        "--engine",
        "1.2.0",
        "--name",
        "App",
      ],
      quietHost(lines),
      defaultPrompter,
      undefined,
      undefined,
      undefined,
      undefined,
      engineRegistry(new Error("offline")),
    );
    assertEquals(code, 0, lines.join("\n"));
    const names = new Set<string>();
    for await (const entry of Deno.readDir(dir)) names.add(entry.name);
    assertEquals(
      [...names].sort(),
      [".gitignore", "build.py", "zuke", "zuke.json", "zuke.ps1"],
    );
    assertEquals(JSON.parse(await Deno.readTextFile(`${dir}/zuke.json`)), {
      name: "App",
      sdk: { command: ["uv", "run", "build.py"] },
      engine: "1.2.0",
    });
    assertStringIncludes(
      await Deno.readTextFile(`${dir}/build.py`),
      "class App(Build):",
    );

    // Forwarded as the launchers would run it: the pinned engine, with the
    // lock named explicitly and no --frozen, since the scaffold has no lock.
    let seen: [string[], string | undefined] | undefined;
    await withEnv({ ZUKE_FORWARDED: "1" }, async () => {
      const forwarded = await main(
        ["--list"],
        quietHost(lines),
        defaultPrompter,
        undefined,
        undefined,
        (_root, args, program) => {
          seen = [args, program];
          return Promise.resolve(0);
        },
        defaultBuildProbe,
      );
      assertEquals(forwarded, 0);
    });
    assertEquals(seen, [
      ["run", "-A", "jsr:@zuke/engine@1.2.0", "--list"],
      undefined,
    ]);
  });
});

Deno.test("zuke upgrade --engine moves a real scaffold's pin and keeps its worker command", async () => {
  await inTempDir(async (dir) => {
    const lines: string[] = [];
    const registry = engineRegistry({
      latest: "1.5.0",
      versions: { "1.5.0": {}, "1.2.0": {} },
    });
    assertEquals(
      await main(
        ["setup", "--yes", "--sdk", "python", "--engine", "1.2.0"],
        quietHost(lines),
        defaultPrompter,
        undefined,
        undefined,
        undefined,
        undefined,
        registry,
      ),
      0,
    );
    const code = await main(
      ["upgrade", "--engine"],
      quietHost(lines),
      defaultPrompter,
      undefined,
      undefined,
      undefined,
      defaultBuildProbe,
      registry,
      defaultProjectHost,
    );
    assertEquals(code, 0, lines.join("\n"));
    assertEquals(JSON.parse(await Deno.readTextFile(`${dir}/zuke.json`)), {
      name: "MyBuild",
      sdk: { command: ["uv", "run", "build.py"] },
      engine: "1.5.0",
    });
  });
});
