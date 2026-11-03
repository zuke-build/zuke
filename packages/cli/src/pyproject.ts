// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `zuke import`'s reader for a Python project: the task table of a
 * `pyproject.toml`, turned into tasks the Python generator renders.
 *
 * The first of these tables present is read, each mapping a name to a task:
 * `[tool.poe.tasks]` (poethepoet), `[tool.pdm.scripts]`,
 * `[tool.hatch.envs.default.scripts]`, `[tool.taskipy.tasks]` and
 * `[tool.rye.scripts]`. A task is a command string; an array of steps (hatch
 * scripts, poe's sequence shorthand); or a table whose `cmd` (a string, or an
 * argv array) or `shell` is the command and whose `sequence` (poe),
 * `composite` (pdm) or `chain` (rye) lists steps. A step that names another
 * task — and a poe `deps` entry, or a `ref` that names one — becomes a
 * dependency, unless a command comes before it: a dependency would run it
 * first, so it stays a `TODO` in its place. Any other step is a command. What no command expresses (a
 * Python `call`/`script`, an `expr`, a `ref` with arguments, a task runner's
 * `{args}` placeholder) is kept verbatim as a step the generator writes as a
 * `TODO` comment. Settings such as `help` and `env` are not carried over.
 *
 * @module
 */

import { isRecord } from "./records.ts";
import { parseToml } from "./toml.ts";

/** One step of an imported Python task, in the order it runs. */
export type PyStep =
  /** A shell command line, translated by `segments`. */
  | { readonly command: string }
  /** An argv the task file already split (pdm's and rye's `cmd = [...]`). */
  | { readonly argv: readonly string[] }
  /** What no command expresses, kept verbatim for a `TODO` comment. */
  | { readonly todo: string };

/** A task read from a `pyproject.toml`, before identifier normalisation. */
export interface PyTask {
  /** The task's name, its key in the task table. */
  readonly name: string;
  /** Its commands, in order. */
  readonly steps: readonly PyStep[];
  /** Names of the other tasks it runs first, without repeats. */
  readonly deps: readonly string[];
}

/** The task tables read, in the order they are looked for. */
const TABLES: readonly (readonly string[])[] = [
  ["tool", "poe", "tasks"],
  ["tool", "pdm", "scripts"],
  ["tool", "hatch", "envs", "default", "scripts"],
  ["tool", "taskipy", "tasks"],
  ["tool", "rye", "scripts"],
];

/** A runner placeholder (`{args}`, `{args:tests}`, `{env:HOME}`) no argv carries. */
const PLACEHOLDER = /\{[^{}]*\}/;

/**
 * Parse a `pyproject.toml` document into tasks, in declaration order, from
 * the first task table it carries. No task table: no tasks.
 *
 * @throws {Error} naming the line, when the document is not TOML this reads.
 */
export function parsePyproject(text: string): PyTask[] {
  let document: unknown;
  try {
    document = parseToml(text);
  } catch (error) {
    // parseToml throws only its own SyntaxError, which names the line.
    throw new Error(
      `zuke import: cannot read pyproject.toml — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const table = TABLES.map((path) => lookup(document, path)).find(isRecord);
  if (table === undefined) return [];
  // pdm keeps options shared by every script under `_`; it is not a task.
  const entries = Object.entries(table).filter(([name]) => name !== "_");
  const names = new Set(entries.map(([name]) => name));
  return entries.map(([name, value]) => {
    const draft: Draft = { steps: [], deps: [] };
    readTask(value, names, draft);
    return { name, ...draft };
  });
}

/** The value at `path` under `value`, or `undefined` when any step is missing. */
function lookup(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/** A task as it is being read: its steps and dependencies so far. */
interface Draft {
  readonly steps: PyStep[];
  readonly deps: string[];
}

/** Read one task definition (a string, an array of steps, or a table) into `into`. */
function readTask(value: unknown, names: Set<string>, into: Draft): void {
  if (typeof value === "string") command(value, into);
  else if (Array.isArray(value)) steps(value, names, into);
  else if (isRecord(value)) readTable(value, names, into);
  else {into.steps.push({
      todo: `translate this task: ${JSON.stringify(value)}`,
    });}
}

/** Read a list of steps: a name of another task is a dependency. */
function steps(
  list: readonly unknown[],
  names: Set<string>,
  into: Draft,
): void {
  for (const item of list) {
    if (typeof item === "string" && names.has(item)) runTask(item, into);
    else readTask(item, names, into);
  }
}

/** Read a task's table form, by whichever key names its kind. */
function readTable(
  table: Record<string, unknown>,
  names: Set<string>,
  into: Draft,
): void {
  // poe runs a task's `deps` before it, whatever its kind.
  if (Array.isArray(table.deps)) {
    for (const dep of table.deps) {
      if (typeof dep === "string" && names.has(dep)) dependOn(dep, into);
    }
  }
  const { cmd, shell, ref } = table;
  const list = table.sequence ?? table.composite ?? table.chain;
  if (typeof cmd === "string") command(cmd, into);
  else if (isStringArray(cmd)) argv(cmd, into);
  else if (typeof shell === "string") command(shell, into);
  else if (Array.isArray(list)) steps(list, names, into);
  else if (typeof ref === "string" && names.has(ref)) runTask(ref, into);
  else {
    into.steps.push({ todo: `translate this task: ${JSON.stringify(table)}` });
  }
}

/** A command line, unless it carries a placeholder only the task runner fills. */
function command(text: string, into: Draft): void {
  into.steps.push(
    PLACEHOLDER.test(text)
      ? { todo: `translate this task runner placeholder: ${text}` }
      : { command: text },
  );
}

/** An argv, unless one of its entries carries a placeholder. */
function argv(list: readonly string[], into: Draft): void {
  into.steps.push(
    list.some((arg) => PLACEHOLDER.test(arg))
      ? { todo: `translate this task runner placeholder: ${list.join(" ")}` }
      : { argv: list },
  );
}

/**
 * Run another task at this point of the steps. Before any step it is a
 * dependency, which runs first just as it would; after one, a dependency would
 * run it too early, so it is kept in its place as a TODO instead.
 */
function runTask(name: string, into: Draft): void {
  if (into.steps.length === 0) dependOn(name, into);
  else {
    into.steps.push({
      todo: `run the ${name} task here; it follows a command, so it is ` +
        "not a dependency",
    });
  }
}

/** Record a dependency once. */
function dependOn(name: string, into: Draft): void {
  if (!into.deps.includes(name)) into.deps.push(name);
}

/** Whether `value` is a non-empty array of strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 &&
    value.every((v) => typeof v === "string");
}
