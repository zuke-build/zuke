// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The guard that a package runs on Node as well as on Deno: its published
 * source makes no direct `Deno.` call. The `zuke` binary is a Node single
 * executable that embeds each wrapper's latest release, so a release still
 * reading `Deno.env` there reads every variable as unset, and one calling
 * `Deno.readFile` throws. Each package goes through core's runtime tasks
 * (`EnvTasks`, `FileTasks`, `ProcessTasks`, …) instead.
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";

/** Every `.ts` file under `dir`, recursively. */
async function sources(dir: URL): Promise<URL[]> {
  const found: URL[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) found.push(...await sources(url));
    else if (entry.name.endsWith(".ts")) found.push(url);
  }
  return found;
}

/**
 * `source` with every comment and every string or template literal's text
 * blanked to spaces, newlines kept so line numbers hold, and the code inside a
 * template's `${…}` kept, so only executable code is left to search.
 *
 * A `/` where an expression can start (after an operator, an opening bracket,
 * a separator or `return`) opens a regular-expression literal, read through its
 * escapes and character classes and blanked like a string.
 *
 * shortcut: the regex-or-division call looks only at the code before the `/`,
 * which is enough for this repository's style; use a real TypeScript scanner
 * if a package ever trips it.
 */
export function codeOnly(source: string): string {
  let out = "";
  const templates: number[] = []; // brace depth at which each open `${` ends
  let depth = 0;
  let i = 0;
  const blank = (c: string) => (c === "\n" ? "\n" : " ");
  /** Skip a template literal's text from `i`, stopping after `` ` `` or `${`. */
  const templateText = () => {
    while (i < source.length) {
      const c = source[i];
      if (c === "\\") {
        out += blank(c) + blank(source[i + 1] ?? "");
        i += 2;
      } else if (c === "`") {
        out += " ";
        i++;
        return;
      } else if (c === "$" && source[i + 1] === "{") {
        out += "${";
        i += 2;
        templates.push(depth++);
        return;
      } else {
        out += blank(c);
        i++;
      }
    }
  };
  const parens: boolean[] = []; // per open `(`: whether it is a statement's condition
  let afterCondition = false; // the last code was the `)` closing such a condition
  /** Whether a `/` at this point starts a regular expression, not a division. */
  const regexCanStart = () => {
    const before = out.trimEnd();
    return before === "" || afterCondition ||
      /[(,=:[!&|?{};+\-*%<>~^]$/.test(before) ||
      /\b(return|typeof|void|delete|in|of|case|do|else|yield|await)$/.test(
        before,
      );
  };
  /** Skip a regular-expression literal's body from `i`, after its opening `/`. */
  const regexBody = () => {
    let inClass = false;
    while (i < source.length && source[i] !== "\n") {
      const c = source[i];
      if (c === "\\") {
        out += blank(c) + blank(source[i + 1] ?? "");
        i += 2;
        continue;
      }
      out += " ";
      i++;
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) return;
    }
  };
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") out += blank(source[i++]);
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (i < stop) out += blank(source[i++]);
    } else if (c === "/" && regexCanStart()) {
      afterCondition = false;
      out += " ";
      i++;
      regexBody();
    } else if (c === "'" || c === '"') {
      afterCondition = false;
      out += " ";
      i++;
      while (i < source.length && source[i] !== c && source[i] !== "\n") {
        const step = source[i] === "\\" ? 2 : 1;
        for (let k = 0; k < step && i < source.length; k++) {
          out += blank(source[i++]);
        }
      }
      if (i < source.length && source[i] === c) {
        out += " ";
        i++;
      }
    } else if (c === "`") {
      afterCondition = false;
      out += " ";
      i++;
      templateText();
    } else if (c === "}" && templates.at(-1) === depth - 1) {
      templates.pop();
      depth--;
      out += "}";
      i++;
      templateText();
    } else {
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === "(") {
        parens.push(/\b(if|while|for|with)\s*$/.test(out));
      }
      const closesCondition = c === ")" && parens.pop() === true;
      out += c;
      i++;
      if (closesCondition) afterCondition = true;
      else if (!/\s/.test(c)) afterCondition = false;
      continue;
    }
  }
  return out;
}

/**
 * The `file:line` of every direct `Deno.` call in a package's `mod.ts` and
 * `src/`, given that package's root (`new URL("../", import.meta.url)` from
 * one of its tests). Empty for a package that runs on Node.
 */
export async function denoCalls(root: URL): Promise<string[]> {
  const files = [
    new URL("mod.ts", root),
    ...await sources(new URL("src/", root)),
  ];
  const calls: string[] = [];
  for (const file of files) {
    const lines = codeOnly(await Deno.readTextFile(file)).split("\n");
    lines.forEach((line, i) => {
      if (/\bDeno\./.test(line)) {
        calls.push(`${file.pathname.slice(root.pathname.length)}:${i + 1}`);
      }
    });
  }
  return calls;
}

/** Fail with each direct `Deno.` call in the package at `root`, if there is any. */
export async function assertRuntimeNeutral(root: URL): Promise<void> {
  assertEquals(await denoCalls(root), []);
}
