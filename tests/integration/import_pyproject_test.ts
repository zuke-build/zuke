// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `zuke import` reading a Python project's
 * `pyproject.toml`: the real `@zuke/cli` `main()` against a real temporary
 * directory, with only the registry faked. What it proves is that the import
 * produces the project `zuke setup --sdk python` makes — a `build.py` of the
 * imported tasks, a `zuke.json` naming the worker command and the pinned
 * engine, the launchers — and that the `zuke` command then forwards to that
 * engine.
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
import { engineRegistry } from "../../packages/cli/tests/_fakes.ts";
import { withEnv } from "../../packages/core/tests/_env.ts";

/** The production host with its log captured. */
function quietHost(lines: string[]): SetupHost {
  return { ...defaultHost, log: (message: string) => void lines.push(message) };
}

/** A project with poethepoet tasks, one of each kind import translates. */
const PYPROJECT = `[project]
name = "app"
requires-python = ">=3.12"

[[tool.mypy.overrides]]
module = "vendored.*"
ignore_errors = true

[tool.poe.tasks]
lint = "ruff check ."
test = { cmd = "pytest -q", help = "Run the tests" }
docs = { script = "app.docs:main" }
ci.sequence = ["lint", "test"]
`;

Deno.test("zuke import turns a pyproject.toml into a Python build on the pinned engine", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-import-py-" });
  const prev = Deno.cwd();
  Deno.chdir(dir);
  try {
    await Deno.writeTextFile(`${dir}/pyproject.toml`, PYPROJECT);
    const lines: string[] = [];
    const code = await main(
      ["import", "--yes", "--engine", "1.2.0", "--name", "App"],
      quietHost(lines),
      defaultPrompter,
      undefined,
      undefined,
      undefined,
      undefined,
      engineRegistry(new Error("offline")),
    );
    assertEquals(code, 0, lines.join("\n"));
    assertStringIncludes(
      lines.join("\n"),
      "imported 4 task(s) from pyproject.toml",
    );

    const names = new Set<string>();
    for await (const entry of Deno.readDir(dir)) names.add(entry.name);
    assertEquals(
      [...names].sort(),
      [
        ".gitignore",
        "build.py",
        "pyproject.toml",
        "zuke",
        "zuke.json",
        "zuke.ps1",
      ],
    );
    assertEquals(JSON.parse(await Deno.readTextFile(`${dir}/zuke.json`)), {
      name: "App",
      sdk: { command: ["uv", "run", "build.py"] },
      engine: "1.2.0",
    });
    const build = await Deno.readTextFile(`${dir}/build.py`);
    assertStringIncludes(build, '# dependencies = ["zuke"]');
    assertStringIncludes(build, "from zuke import Build, Context, run, target");
    assertStringIncludes(build, 'await ctx.sh("ruff", "check", ".")');
    assertStringIncludes(build, 'await ctx.sh("pytest", "-q")');
    assertStringIncludes(
      build,
      '# TODO: translate this task: {"script":"app.docs:main"}',
    );
    assertStringIncludes(
      build,
      '    ci = target().description("imported: ci").depends_on(lint, test)\n',
    );
    assertStringIncludes(build, "class App(Build):");
    assertStringIncludes(build, "\nrun(App)\n");

    // The zuke command forwards to the engine the import pinned.
    let seen: string[] | undefined;
    await withEnv({ ZUKE_FORWARDED: "1" }, async () => {
      const forwarded = await main(
        ["--list"],
        quietHost(lines),
        defaultPrompter,
        undefined,
        undefined,
        (_root, args) => {
          seen = args;
          return Promise.resolve(0);
        },
        defaultBuildProbe,
      );
      assertEquals(forwarded, 0);
    });
    assertEquals(seen, ["run", "-A", "jsr:@zuke/engine@1.2.0", "--list"]);
  } finally {
    Deno.chdir(prev);
    await Deno.remove(dir, { recursive: true });
  }
});
