// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `zuke setup --sdk python` and
 * `zuke upgrade --engine`: the real `@zuke/cli` `main()` against a real
 * temporary directory, with only the releases faked. What it proves is the
 * acceptance criterion: the scaffold's launchers run the pinned `zuke`
 * binary and nothing from Deno's stack, the `zuke` command forwards to the
 * engine that release carries, and the project can be moved to another.
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
import { pinRegistry, testPin } from "../../packages/cli/tests/_fakes.ts";
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
    const code = await main(
      [
        "setup",
        "--yes",
        "--sdk",
        "python",
        "--zuke",
        "2.3.0",
        "--name",
        "App",
      ],
      quietHost(lines),
      defaultPrompter,
      undefined,
      undefined,
      undefined,
      undefined,
      pinRegistry([testPin("2.3.0", "1.2.0")]),
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
    for (const launcher of ["zuke", "zuke.ps1"]) {
      const text = await Deno.readTextFile(`${dir}/${launcher}`);
      assertStringIncludes(text, "2.3.0");
      assertEquals(/deno/i.test(text), false, launcher);
    }

    // Forwarded by a Deno-installed zuke, whose user is on Deno already: the
    // pinned engine, with no --frozen, since the scaffold has no lock.
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

    // The rest of the zuke command treats it as the Python build it is: the
    // version names zuke.json and the engine, and the Deno-project commands
    // refuse it rather than writing a deno.json into it.
    const report: string[] = [];
    await withEnv({ ZUKE_FORWARDED: "1" }, async () => {
      await main(
        ["--version"],
        quietHost(report),
        defaultPrompter,
        undefined,
        undefined,
        () => Promise.resolve(0),
        defaultBuildProbe,
      );
    });
    assertStringIncludes(
      report.join("\n"),
      "zuke.json, on @zuke/engine 1.2.0",
    );
    const refused: string[] = [];
    const added = await main(
      ["add", "docker"],
      quietHost(refused),
      defaultPrompter,
      undefined,
      undefined,
      undefined,
      defaultBuildProbe,
      undefined,
      defaultProjectHost,
    );
    assertEquals(added, 1);
    assertStringIncludes(refused.join("\n"), "is a build another SDK hosts");
    assertEquals(await Deno.stat(`${dir}/deno.json`).catch(() => null), null);
  });
});

Deno.test("zuke upgrade --engine moves a real scaffold to the latest zuke, keeping its worker command", async () => {
  await inTempDir(async (dir) => {
    const lines: string[] = [];
    const registry = pinRegistry([
      testPin("2.4.0", "1.5.0"),
      testPin("2.3.0", "1.2.0"),
    ]);
    assertEquals(
      await main(
        ["setup", "--yes", "--sdk", "python", "--zuke", "2.3.0"],
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
    assertStringIncludes(
      await Deno.readTextFile(`${dir}/zuke`),
      'ZUKE_VERSION="2.4.0"',
    );
    assertStringIncludes(
      await Deno.readTextFile(`${dir}/zuke.ps1`),
      '$ZukeVersion = "2.4.0"',
    );
    if (Deno.build.os !== "windows") {
      // Rewritten in place, so the launcher stays executable.
      const mode = (await Deno.stat(`${dir}/zuke`)).mode ?? 0;
      assertEquals(mode & 0o111, 0o111);
    }
  });
});
