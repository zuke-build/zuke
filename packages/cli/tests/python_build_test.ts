// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { parsePyproject } from "../src/pyproject.ts";
import {
  generatePythonBuild,
  toPythonIdentifier,
} from "../src/python_build.ts";
import { starterPythonBuild } from "../src/starter.ts";

Deno.test("toPythonIdentifier produces snake_case field names", () => {
  assertEquals(toPythonIdentifier("lint"), "lint");
  assertEquals(toPythonIdentifier("test-watch"), "test_watch");
  assertEquals(toPythonIdentifier("lint:fix"), "lint_fix");
  assertEquals(toPythonIdentifier("buildProd"), "build_prod");
  assertEquals(toPythonIdentifier("_private"), "private");
  assertEquals(toPythonIdentifier("2fast"), "task_2fast");
  assertEquals(toPythonIdentifier("---"), "task");
  assertEquals(toPythonIdentifier("café"), "caf");
});

Deno.test("generatePythonBuild renders the starter's shape, as ruff formats it", () => {
  const out = generatePythonBuild(
    "MyBuild",
    parsePyproject(`
[tool.poe.tasks]
lint = "ruff check ."
test = { cmd = "pytest -q", deps = ["lint"] }
types = "pyright | tee out.txt"
check = ["lint", "test"]
`),
  );
  assertEquals(
    out,
    `# /// script
# requires-python = ">=3.12"
# dependencies = ["zuke"]
# ///
"""Imported build: refine these targets into typed Zuke tasks."""

from zuke import Build, Context, run, target


async def _lint(ctx: Context) -> None:
    await ctx.sh("ruff", "check", ".")


async def _test(ctx: Context) -> None:
    await ctx.sh("pytest", "-q")


async def _types(ctx: Context) -> None:
    # TODO: translate this shell command: pyright | tee out.txt
    pass


class MyBuild(Build):
    """The targets imported from pyproject.toml."""

    lint = target().description("imported: lint").executes(_lint)

    test = target().description("imported: test").depends_on(lint).executes(_test)

    types = target().description("imported: types").executes(_types)

    check = target().description("imported: check").depends_on(lint, test)


run(MyBuild)
`,
  );
  // The same script metadata and import line `setup --sdk python` writes.
  const starter = starterPythonBuild("MyBuild");
  assertEquals(
    out.slice(0, out.indexOf('"""')),
    starter.slice(0, starter.indexOf('"""')),
  );
  assertStringIncludes(starter, "from zuke import Build, run, target");
});

Deno.test("generatePythonBuild declares a dependency above its dependent", () => {
  const out = generatePythonBuild("B", [
    { name: "ci", steps: [], deps: ["build"] },
    { name: "build", steps: [{ argv: ["make"] }], deps: [] },
  ]);
  assertEquals(out.indexOf("    build = ") < out.indexOf("    ci = "), true);
  assertStringIncludes(
    out,
    '    ci = target().description("imported: ci").depends_on(build)\n',
  );
});

Deno.test("generatePythonBuild wraps what does not fit in 88 columns", () => {
  const long =
    "a_task_name_long_enough_that_nothing_about_it_fits_on_one_line_x";
  const out = generatePythonBuild("B", [
    { name: long, steps: [{ argv: ["echo", "x".repeat(70)] }], deps: [] },
    {
      name: "many",
      steps: [{ argv: Array.from({ length: 12 }, (_, i) => `--flag-${i}`) }],
      deps: [long],
    },
    { name: "y".repeat(80), steps: [], deps: [] },
  ]);
  assertStringIncludes(
    out,
    `async def _${long}(\n    ctx: Context,\n) -> None:\n    await ctx.sh(\n        "echo", "${
      "x".repeat(70)
    }"\n    )\n`,
  );
  assertStringIncludes(
    out,
    `    await ctx.sh(\n        "--flag-0",\n        "--flag-1",\n`,
  );
  assertStringIncludes(
    out,
    `    ${long} = (\n        target()\n        .description(\n            "imported: ${long}"\n        )\n        .executes(_${long})\n    )\n`,
  );
  assertStringIncludes(out, `        .depends_on(${long})\n`);
  // One call alone: its argument moves to the next line, with no chain parens.
  assertStringIncludes(
    out,
    `    ${"y".repeat(80)} = target().description(\n        "imported: ${
      "y".repeat(80)
    }"\n    )\n`,
  );
});

Deno.test("generatePythonBuild keeps names valid, distinct and clear of Build's own", () => {
  const out = generatePythonBuild("B", [
    { name: "import", steps: [], deps: [] },
    { name: "target", steps: [], deps: [] },
    { name: "describe", steps: [], deps: [] },
    { name: "lint-fix", steps: [], deps: [] },
    { name: "lint:fix", steps: [], deps: ["import", "target"] },
  ]);
  assertStringIncludes(out, "    import_ = target()");
  // `target_` is Build's own; `target` would shadow the class body's target().
  assertStringIncludes(out, "    target__ = target()");
  assertStringIncludes(out, "    describe_ = target()");
  assertStringIncludes(out, "    lint_fix = target()");
  assertStringIncludes(
    out,
    '    lint_fix_ = target().description("imported: lint:fix").depends_on(import_, target__)',
  );
});

Deno.test("generatePythonBuild escapes every string and comment it emits", () => {
  const nasty = 'a"b\\c\n"""\u2028\u0000)';
  const out = generatePythonBuild("B", [
    {
      name: nasty,
      steps: [{ argv: ["echo", nasty] }, { todo: nasty }],
      deps: [],
    },
    { name: "sh", steps: [{ command: `echo "x\ny" ; rm -rf /` }], deps: [] },
  ]);
  const literal = '"a\\"b\\\\c\\n\\"\\"\\"\\u2028\\u0000)"';
  assertStringIncludes(out, `await ctx.sh("echo", ${literal})`);
  assertStringIncludes(out, `.description("imported: ${literal.slice(1)}`);
  assertStringIncludes(out, '    # TODO: a"b\\c """ )\n');
  assertStringIncludes(
    out,
    '    # TODO: translate this shell command: echo "x y" ; rm -rf /\n',
  );
  // Nothing raw that Python would read as a line break or refuse.
  assertEquals(out.includes("\u0000") || out.includes("\u2028"), false);
  for (const line of out.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    assertEquals(line.includes("rm -rf"), false);
  }
});

Deno.test("generatePythonBuild notes a dropped cycle edge instead of a forward reference", () => {
  const out = generatePythonBuild("B", [
    { name: "a", steps: [], deps: ["b"] },
    { name: "b", steps: [], deps: ["a"] },
    { name: "self", steps: [], deps: ["self"] },
  ]);
  assertStringIncludes(
    out,
    '    # TODO: dependency cycle, dropped .depends_on(a)\n    b = target().description("imported: b")\n',
  );
  assertStringIncludes(
    out,
    '    a = target().description("imported: a").depends_on(b)\n',
  );
  assertStringIncludes(
    out,
    '    # TODO: dependency cycle, dropped .depends_on(self)\n    self = target().description("imported: self")\n',
  );
});

Deno.test("generatePythonBuild renders an empty task list without a Context import", () => {
  const out = generatePythonBuild("Empty", []);
  assertStringIncludes(out, "from zuke import Build, run, target\n");
  assertStringIncludes(
    out,
    '    """The targets imported from pyproject.toml."""\n\n    # No tasks were found to import, add targets here.\n',
  );
  assertStringIncludes(out, "\n\n\nrun(Empty)\n");
});
