// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `zuke import`'s Python generator: the `build.py` a `pyproject.toml`'s tasks
 * translate to, in the shape of `zuke setup --sdk python`'s starter — the
 * same script metadata, `from zuke import …` line, class and `run(...)` —
 * with one `target()` field per task. Each task's commands run in a
 * module-level `async def` body through `await ctx.sh("prog", "arg", …)`,
 * split with the same rules as the TypeScript path; what cannot be translated
 * is kept as a `# TODO` comment. The output is laid out as ruff formats it
 * (4-space indent, double quotes, 88 columns), so a project's own formatter
 * leaves it alone.
 *
 * @module
 */

import type { PyStep, PyTask } from "./pyproject.ts";
import { PYTHON_SCRIPT_METADATA } from "./starter.ts";
import { literal, normalize, oneLine, order, segments } from "./translate.ts";

/** The line length ruff formats to by default. */
const LINE_LENGTH = 88;

/**
 * Names a target field may not take: Python's keywords, the `target` the
 * class body calls (a field of that name would shadow it for every field
 * below), and the attributes `zuke.Build` defines itself. A task normalising
 * to one is suffixed with `_` instead.
 */
const RESERVED: ReadonlySet<string> = new Set([
  // keyword.kwlist, less the capitalised three no snake_case name can be
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
  // the class body's own name
  "target",
  // zuke.Build's attributes
  "deadline",
  "unforceable",
  "targets_",
  "parameters_",
  "groups_",
  "ci_",
  "on_start",
  "on_target_start",
  "on_target_end",
  "on_finish",
  "hooks_",
  "describe",
  "configure",
  "target_",
  "service_",
]);

/**
 * Turn a task name into a snake_case Python identifier for a target field —
 * `test-watch` → `test_watch`, `buildProd` → `build_prod`, `lint:fix` →
 * `lint_fix`. Falls back to `task` for an empty result and prefixes a leading
 * digit. Never starts or ends with `_`, so no result is private or mangled.
 */
export function toPythonIdentifier(name: string): string {
  const id = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase())
    .join("_");
  if (id === "") return "task";
  return /^[0-9]/.test(id) ? `task_${id}` : id;
}

/**
 * Generate a `build.py` whose build class is named `className` from tasks a
 * `pyproject.toml` declared. Every string it emits goes through the one
 * escaper (`literal`), and every comment through `oneLine`.
 */
export function generatePythonBuild(
  className: string,
  tasks: readonly PyTask[],
): string {
  const { ordered, dropped } = order(
    normalize(tasks, toPythonIdentifier, RESERVED),
  );
  const functions: string[] = [];
  const fields: string[] = [];
  for (const { id, task, deps } of ordered) {
    const body = bodyLines(task.steps);
    const fn = body.length > 0 ? `_${id}` : undefined;
    if (fn !== undefined) {
      const def = `async def ${fn}(ctx: Context) -> None:`;
      // ruff explodes a signature that does not fit, with a trailing comma.
      const head = def.length <= LINE_LENGTH
        ? def
        : `async def ${fn}(\n    ctx: Context,\n) -> None:`;
      functions.push(`${head}\n${body.join("\n")}`);
    }
    const calls: [string, string[]][] = [
      [".description", [literal(`imported: ${task.name}`)]],
    ];
    if (deps.length > 0) calls.push([".depends_on", [...deps]]);
    if (fn !== undefined) calls.push([".executes", [fn]]);
    const lines: string[] = [];
    const skipped = dropped.get(id);
    if (skipped !== undefined) {
      lines.push(
        `    # TODO: dependency cycle, dropped .depends_on(${
          skipped.join(", ")
        })`,
      );
    }
    lines.push(...field(id, calls));
    fields.push(lines.join("\n"));
  }

  const names = functions.length > 0
    ? "Build, Context, run, target"
    : "Build, run, target";
  const members = fields.length > 0
    ? fields.join("\n\n")
    : "    # No tasks were found to import, add targets here.";
  const sections = [
    `${PYTHON_SCRIPT_METADATA}"""Imported build: refine these targets into typed Zuke tasks."""\n\nfrom zuke import ${names}`,
    ...functions,
    `class ${className}(Build):\n    """The targets imported from pyproject.toml."""\n\n${members}`,
    `run(${className})\n`,
  ];
  return sections.join("\n\n\n");
}

/** The statements of a body, indented: `await ctx.sh(...)` and `# TODO` lines. */
function bodyLines(steps: readonly PyStep[]): string[] {
  const lines: string[] = [];
  let runnable = false;
  const run = (argv: readonly string[]) => {
    runnable = true;
    lines.push(...call(4, "await ctx.sh", argv.map(literal)));
  };
  const todo = (text: string) => lines.push(`    # TODO: ${oneLine(text)}`);
  for (const step of steps) {
    if ("todo" in step) todo(step.todo);
    else if ("argv" in step) run(step.argv);
    else {
      for (const segment of segments(step.command)) {
        if ("raw" in segment) {
          todo(`translate this shell command: ${segment.raw}`);
        } else run(segment.argv);
      }
    }
  }
  // A body of comments alone is not a statement Python accepts.
  if (lines.length > 0 && !runnable) lines.push("    pass");
  return lines;
}

/**
 * A target field, `id = target().description(...)…`, on one line when it
 * fits; otherwise as ruff lays out a long method chain — wrapped in
 * parentheses, one call per line — or, for a lone call, with its argument
 * moved to the next line.
 */
function field(id: string, calls: readonly [string, string[]][]): string[] {
  const chain = calls.map(([name, args]) => `${name}(${args.join(", ")})`);
  const flat = `    ${id} = target()${chain.join("")}`;
  if (flat.length <= LINE_LENGTH) return [flat];
  if (calls.length === 1) {
    return call(4, `${id} = target()${calls[0][0]}`, calls[0][1]);
  }
  return [
    `    ${id} = (`,
    "        target()",
    ...calls.flatMap(([name, args]) => call(8, name, args)),
    "    )",
  ];
}

/**
 * `head(args)` at `indent` spaces, as ruff splits a call that does not fit:
 * on one line; else the arguments together on the next line; else one per
 * line with a trailing comma. A single argument is never exploded further.
 */
function call(indent: number, head: string, args: readonly string[]): string[] {
  const pad = " ".repeat(indent);
  const flat = `${pad}${head}(${args.join(", ")})`;
  if (flat.length <= LINE_LENGTH) return [flat];
  const inner = `${pad}    ${args.join(", ")}`;
  if (args.length === 1 || inner.length <= LINE_LENGTH) {
    return [`${pad}${head}(`, inner, `${pad})`];
  }
  return [`${pad}${head}(`, ...args.map((a) => `${pad}    ${a},`), `${pad})`];
}
