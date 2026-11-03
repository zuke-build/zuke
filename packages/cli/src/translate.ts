// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The language-neutral half of `zuke import`: splitting an imported shell
 * command into argv (or flagging it as too shell-specific to translate),
 * quoting a value into a generated source file, and giving imported tasks
 * unique identifiers in a declaration order with no forward reference. The
 * TypeScript (`zuke.ts`) and Python (`build.py`) generators both render from
 * these, so the two can never disagree about what a command means.
 *
 * @module
 */

import { splitShellArgs } from "@zuke/core/shell";

/** One `&&`-separated segment of a command: argv to run, or text to keep verbatim. */
export type Segment =
  | { readonly argv: readonly string[] }
  | { readonly raw: string };

/** Shell features a single argv cannot faithfully express. */
function needsShell(segment: string): boolean {
  // pipe, redirect, subst, env expand, and a newline (a second command)
  if (/[|<>;`$\n\r]/.test(segment)) return true;
  if (/(^|\s)&(\s|$)/.test(segment)) return true; // background job
  if (hasUnquotedBackslash(segment)) return true; // escape or Windows separator?
  const first = segment.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(first); // leading VAR=value assignment
}

/**
 * Whether `segment` contains a backslash outside quotes, which is ambiguous and
 * therefore not translatable: a POSIX shell reads it as an escape (`a\ b` is one
 * argument), while a `package.json` script written on Windows — where npm runs
 * scripts through `cmd.exe` — uses it as a path separator (`node scripts\b.js`).
 * Picking either reading silently changes the command, so the segment is
 * preserved verbatim for a human to resolve. A backslash inside quotes is
 * unambiguous and stays translatable.
 */
function hasUnquotedBackslash(segment: string): boolean {
  let quote: string | undefined;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote !== undefined) {
      // Inside double quotes a backslash escapes the next character, so skip it
      // and keep tracking the quote state accurately.
      if (quote === '"' && ch === "\\") i++;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "\\") return true;
  }
  return false;
}

/**
 * Split a shell command into its `&&`-separated segments, each one argv
 * (never empty: a segment is non-blank and holds no backslash), or the raw
 * text when it is too shell-specific to translate (or its quoting does not
 * balance). Blank segments are dropped.
 */
export function segments(command: string): Segment[] {
  const out: Segment[] = [];
  for (const raw of splitChain(command)) {
    const segment = raw.trim();
    if (segment === "") continue;
    const argv = needsShell(segment) ? undefined : tokenize(segment);
    out.push(argv === undefined ? { raw: segment } : { argv });
  }
  return out;
}

/** Split a command on top-level `&&`, ignoring `&&` inside quotes. */
export function splitChain(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote !== undefined) {
      current += ch;
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "&" && command[i + 1] === "&") {
      parts.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Split a command segment into argv with POSIX quoting rules, or `undefined`
 * when the segment's quoting is unbalanced. An unterminated quote is not
 * translatable, so the caller falls back to preserving the raw text — the
 * scaffold must never silently drop half a command.
 */
export function tokenize(segment: string): string[] | undefined {
  try {
    return splitShellArgs(segment);
  } catch {
    return undefined; // Only ShellArgsError can escape splitShellArgs.
  }
}

/**
 * A double-quoted string literal for `value`, valid as TypeScript and as
 * Python alike — the one escaper every generated literal goes through.
 *
 * `JSON.stringify` escapes quotes, backslashes, and control characters (as
 * `\n`, `\t`, `\uXXXX`, which both languages read the same way), but leaves
 * U+2028/U+2029 raw — legal inside JSON strings, line terminators to a
 * JavaScript parser — so those are escaped on top, keeping the generated
 * literal on one line whatever the imported command contains.
 */
export function literal(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * `text` on one line, fit for a `//` or `#` comment: every run of whitespace
 * or control characters collapses to a space, so an embedded newline cannot
 * break the text out of its comment, and a NUL (which Python refuses in
 * source) never reaches the file.
 */
export function oneLine(text: string): string {
  // deno-lint-ignore no-control-regex -- matching control characters is the point
  return text.replace(/[\s\x00-\x1f\x7f]+/g, " ").trim();
}

// --- identifiers and order ----------------------------------------------

/** An imported task with a unique identifier and its dependencies remapped to identifiers. */
export interface Named<T> {
  /** The identifier of the generated target field. */
  readonly id: string;
  /** The task as it was imported. */
  readonly task: T;
  /** The identifiers of the tasks it depends on (unknown names dropped). */
  readonly deps: readonly string[];
}

/**
 * Give each task a unique identifier — `toId` of its name, suffixed with `_`
 * until it collides with neither another task's nor a `reserved` one — and
 * remap its dependencies to those identifiers.
 */
export function normalize<T extends { name: string; deps: readonly string[] }>(
  tasks: readonly T[],
  toId: (name: string) => string,
  reserved: ReadonlySet<string>,
): Named<T>[] {
  const idByName = new Map<string, string>();
  const used = new Set(reserved);
  for (const task of tasks) {
    let id = toId(task.name);
    while (used.has(id)) id = `${id}_`;
    used.add(id);
    idByName.set(task.name, id);
  }
  return tasks.map((task) => ({
    id: idByName.get(task.name) ?? toId(task.name),
    task,
    deps: task.deps
      .map((d) => idByName.get(d))
      .filter((d): d is string => d !== undefined),
  }));
}

/**
 * Order tasks so every dependency is declared before its dependents (Zuke
 * forbids forward references), dropping the edges that would close a cycle
 * (a task naming itself included). Returns the order — each task's `deps`
 * without its dropped edges, so every one names a task declared above it —
 * plus, per task id, the dependency ids that were dropped.
 */
export function order<T>(
  tasks: readonly Named<T>[],
): { ordered: Named<T>[]; dropped: Map<string, string[]> } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, "open" | "done">();
  const ordered: Named<T>[] = [];
  const dropped = new Map<string, string[]>();
  const visit = (task: Named<T>) => {
    state.set(task.id, "open");
    for (const dep of task.deps) {
      const target = byId.get(dep);
      if (target === undefined) continue;
      const st = state.get(dep);
      if (st === "open") {
        dropped.set(task.id, [...(dropped.get(task.id) ?? []), dep]);
      } else if (st === undefined) {
        visit(target);
      }
    }
    state.set(task.id, "done");
    const cut = dropped.get(task.id) ?? [];
    ordered.push({ ...task, deps: task.deps.filter((d) => !cut.includes(d)) });
  };
  for (const task of tasks) {
    if (state.get(task.id) === undefined) visit(task);
  }
  return { ordered, dropped };
}
