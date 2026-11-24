// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * No package source calls Deno's own API, apart from what is allowed below.
 *
 * Zuke is moving to run on Node as well as Deno (#992). Package source talks
 * to the runtime through `node:` modules, which Deno also provides, and the
 * few things that must stay Deno's on Deno sit behind small seams in core.
 * This test holds that line: a `Deno.` in package code outside the
 * allowance fails it.
 *
 * The allowance is a ratchet. It names each file still allowed a use and how
 * many. A file that grows past its number fails, and so does one that drops
 * below it, so the number is lowered when a use goes and cannot creep back.
 *
 * Only code counts. Comments, and the text of strings, which may well name
 * Deno, are skipped; the code inside a template string's `${…}` counts.
 * The scanner reads tokens, it does not parse: a regular expression literal
 * holding a quote can confuse it, and a review still has to catch that.
 *
 * @module
 */

import { test } from "../packages/core/tests/_testing.ts";
import { assertEquals } from "../packages/core/tests/_assert.ts";
import { packageSources } from "./_package_sources.ts";

/**
 * Where a use of Deno's API is allowed, by file and how many.
 *
 * - Core's runtime seams, which keep Deno's own behaviour on Deno and use
 *   Node's elsewhere, and so name Deno on purpose.
 * - `@zuke/deno`, which wraps the Deno CLI.
 * - Everything else is still to move, package by package; each slice that
 *   moves a file lowers or removes its line.
 */
const ALLOWED: Record<string, number> = {
  // Core's runtime seams.
  "packages/core/src/fs.ts": 6,
  "packages/core/src/internal.ts": 4,
  "packages/core/src/process.ts": 3,
  "packages/core/src/runtime.ts": 7,
  "packages/core/src/serve.ts": 1,
  "packages/core/src/stdio.ts": 4,
  // The Deno CLI's own wrapper.
  "packages/deno/src/deno.ts": 1,
};

/**
 * `source` with only its code left: comments and the text of string and
 * template literals become spaces, so what remains can be searched without
 * finding a word that is only written about.
 */
export function codeOnly(source: string): string {
  let out = "";
  // The open template literals, innermost last, each with how many braces
  // deep its current `${…}` is; empty while in plain code.
  const templates: number[] = [];
  let at = 0;
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  while (at < source.length) {
    const rest = source.slice(at);
    const inTemplateText = templates.length > 0 &&
      templates[templates.length - 1] === 0;
    if (inTemplateText) {
      const end = rest.search(/\\[\s\S]|`|\$\{/);
      if (end === -1) return out + blank(rest);
      out += blank(rest.slice(0, end));
      at += end;
      if (source[at] === "\\") {
        out += "  ";
        at += 2;
      } else if (source[at] === "`") {
        templates.pop();
        out += " ";
        at += 1;
      } else {
        templates[templates.length - 1] = 1;
        out += "  ";
        at += 2;
      }
      continue;
    }
    const char = source[at];
    if (rest.startsWith("//")) {
      const end = rest.indexOf("\n");
      const comment = end === -1 ? rest : rest.slice(0, end);
      out += blank(comment);
      at += comment.length;
    } else if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/", 2);
      const comment = end === -1 ? rest : rest.slice(0, end + 2);
      out += blank(comment);
      at += comment.length;
    } else if (char === '"' || char === "'") {
      const match = rest.match(
        new RegExp(`^${char}(?:\\\\[\\s\\S]|[^${char}\\\\\\n])*${char}?`),
      );
      const literal = match?.[0] ?? char;
      out += blank(literal);
      at += literal.length;
    } else if (char === "`") {
      templates.push(0);
      out += " ";
      at += 1;
    } else {
      if (templates.length > 0) {
        const depth = templates.length - 1;
        if (char === "{") templates[depth]++;
        if (char === "}") templates[depth]--;
        if (templates[depth] === 0) {
          out += " ";
          at += 1;
          continue;
        }
      }
      out += char;
      at += 1;
    }
  }
  return out;
}

/** How many times `source`'s code names Deno's API. */
export function denoUses(source: string): number {
  // A property read in any form: `.`, `?.` or `[`, with any spacing or line
  // break around it, as a formatter may split a chain.
  return Array.from(
    codeOnly(source).matchAll(/\bDeno\s*(?:\?\.|\.|\[)/g),
  ).length;
}

test("only code is counted: comments and the text of strings are not", () => {
  const cases: [source: string, uses: number][] = [
    ["const cwd = Deno.cwd();", 1],
    ["new Deno.Command(Deno.execPath(), { env: Deno.env.toObject() })", 3],
    ["let output: Deno.CommandOutput;", 1],
    // Written about, not called.
    ["// Deno.cwd() would be wrong here", 0],
    ["/** Like `Deno.symlink`. */ const x = 1;", 0],
    ["/* Deno.exit(1)\n Deno.exit(2) */", 0],
    ['const message = "use Deno.env instead";', 0],
    ["const line = 'Deno.exit(3)';", 0],
    ["const generated = `await Deno.readTextFile(path)`;", 0],
    // Code inside a template's `${…}` is code, nested or not.
    ["const s = `cwd: ${Deno.cwd()}`;", 1],
    ["const s = `a ${`b ${Deno.pid}`} ${{ x: Deno.pid }.x}`;", 2],
    // A string holding a comment marker, and an escaped quote.
    ['const url = "http://x"; Deno.exit(0);', 1],
    ['const q = "a \\" Deno.exit"; Deno.exit(0);', 1],
    // A name that only ends in Deno is not Deno.
    ["const onDeno = myDeno.thing;", 0],
    // However the property is reached, and however it is spaced.
    ["const cwd = Deno\n  .cwd();", 1],
    ["Deno . exit(0);", 1],
    ["const e = Deno?.env;", 1],
    ['const e = Deno["env"];', 1],
    // Asking whether Deno is there at all is not using its API.
    ['const onDeno = typeof Deno !== "undefined";', 0],
  ];
  for (const [source, expected] of cases) {
    assertEquals(denoUses(source), expected, source);
  }
});

test("no package source uses Deno's API outside its allowance", async () => {
  const found: Record<string, number> = {};
  for (const file of await packageSources()) {
    const uses = denoUses(await Deno.readTextFile(file));
    if (uses > 0) found[file] = uses;
  }
  assertEquals(
    found,
    ALLOWED,
    "package source talks to the runtime through node: modules, so it runs " +
      "on Node as well as Deno. A use that must stay Deno's on Deno belongs " +
      "behind one of core's runtime seams (runtime.ts, process.ts, stdio.ts, " +
      "serve.ts, fs.ts, internal.ts). If a file now uses Deno less, lower its " +
      "allowance.",
  );
});
