// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `zuke setup --runtime node`: the real `@zuke/cli`
 * `main()` against a real temporary directory. What it proves is the
 * acceptance criterion: the scaffold is a complete Node project (its
 * `zuke.json` selects the Node runtime, `package.json` carries the npm alias
 * of `@zuke/core`) and nothing it writes names Deno.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { test } from "../_testing.ts";
import { assertEquals, assertStringIncludes } from "../_assert.ts";
import { defaultPrompter, main } from "../../packages/cli/mod.ts";
import { defaultHost, type SetupHost } from "../../packages/cli/src/setup.ts";
import { runtimeNamed } from "../../packages/cli/src/runtime_field.ts";
import { buildFileNamed } from "../../packages/cli/src/build_file.ts";

/** The production host with its log captured. */
function quietHost(lines: string[]): SetupHost {
  return { ...defaultHost, log: (message: string) => void lines.push(message) };
}

test("zuke setup --runtime node scaffolds a Node project that names no Deno", async () => {
  const dir = await FileTasks.makeTempDirectory((s) =>
    s.prefix("zuke-it-node-")
  );
  try {
    await FileTasks.writeText(`${dir}/package.json`, '{"name":"mine"}');
    const lines: string[] = [];
    const code = await main(
      ["setup", "--yes", "--runtime", "node", "--mcp", "--dir", dir],
      quietHost(lines),
      defaultPrompter,
    );
    assertEquals(code, 0, lines.join("\n"));
    const names: string[] = [];
    for (const entry of await FileTasks.readDirectory(dir)) {
      names.push(entry.name);
    }
    assertEquals(
      names.sort(),
      [
        ".gitignore",
        ".mcp.json",
        "build.ts",
        "package.json",
        "zuke",
        "zuke.json",
        "zuke.ps1",
      ],
    );
    const config = await FileTasks.readText(`${dir}/zuke.json`);
    assertEquals(runtimeNamed(config), "node");
    assertEquals(buildFileNamed(config), "build.ts");
    assertEquals(JSON.parse(await FileTasks.readText(`${dir}/package.json`)), {
      name: "mine",
      type: "module",
      dependencies: { "@zuke/core": "npm:@zuke-build/core@^1" },
    });
    assertStringIncludes(
      await FileTasks.readText(`${dir}/build.ts`),
      'from "@zuke/core"',
    );
    assertEquals(
      (await FileTasks.readText(`${dir}/.gitignore`)).split("\n").includes(
        "node_modules/",
      ),
      true,
    );
    for (const name of names) {
      assertEquals(
        /deno/i.test(await FileTasks.readText(`${dir}/${name}`)),
        false,
        name,
      );
    }
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
});

test("zuke setup creates the --dir it is given when it is not there yet", async () => {
  const root = await FileTasks.makeTempDirectory((s) =>
    s.prefix("zuke-it-node-")
  );
  try {
    const dir = `${root}/new/project`;
    const lines: string[] = [];
    const code = await main(
      ["setup", "--yes", "--runtime", "node", "--dir", dir],
      quietHost(lines),
      defaultPrompter,
    );
    assertEquals(code, 0, lines.join("\n"));
    assertEquals(
      runtimeNamed(await FileTasks.readText(`${dir}/zuke.json`)),
      "node",
    );
    assertEquals((await FileTasks.stat(`${dir}/zuke`)).isFile, true);
  } finally {
    await FileTasks.remove(root, { recursive: true });
  }
});
