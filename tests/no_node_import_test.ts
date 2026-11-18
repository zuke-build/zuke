// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * No package source outside core imports a `node:` module, apart from what is
 * allowed below.
 *
 * Core owns the runtime: its task objects (`FileTasks`, `EnvTasks`,
 * `ProcessTasks`, `RuntimeTasks`, `StreamTasks`, `NetTasks`) are how every
 * other package reads files, the environment and the process, so moving Zuke
 * to another runtime is a change to core alone. The companion test,
 * `no_deno_api_test.ts`, holds the same line for Deno's own API.
 *
 * The allowance is a ratchet, as there: each file named may import exactly
 * that many `node:` modules, no more and no fewer.
 *
 * Comments are skipped. Strings are not, since an import specifier is one: a
 * `node:` import written into generated code is counted, and allowed below by
 * name.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { packageSources, withoutComments } from "./_package_sources.ts";

/**
 * Where a package outside core may import a `node:` module, by file and how
 * many. Everything still to move is named here; each slice that moves a file
 * lowers or removes its line.
 */
const ALLOWED: Record<string, number> = {
  // Per-call context for the engine's redaction, which is not a difference
  // between runtimes.
  "packages/engine/src/host.ts": 1,
  // Text of a module this package writes for Node to run, not an import of
  // its own.
  "packages/node/src/evaluate.ts": 1,
};

/** How many `node:` modules `source` imports, statically or dynamically. */
function nodeImports(source: string): number {
  return Array.from(
    withoutComments(source).matchAll(
      /\b(?:from|import)\s*\(?\s*["']node:[^"']*["']/g,
    ),
  ).length;
}

Deno.test("static and dynamic node: imports are counted, comments are not", () => {
  const cases: [source: string, imports: number][] = [
    ['import process from "node:process";', 1],
    ["import { readFile } from 'node:fs/promises';", 1],
    ['const net = await import("node:net");', 1],
    ['export { join } from "node:path";', 1],
    ['import { FileTasks } from "@zuke/core";', 0],
    ['// import process from "node:process";', 0],
    ['/** Not `import x from "node:fs"`. */ const x = 1;', 0],
  ];
  for (const [source, expected] of cases) {
    assertEquals(nodeImports(source), expected, source);
  }
});

Deno.test("no package outside core imports a node: module outside its allowance", async () => {
  const found: Record<string, number> = {};
  for (const file of await packageSources()) {
    if (file.startsWith("packages/core/")) continue;
    const imports = nodeImports(await Deno.readTextFile(file));
    if (imports > 0) found[file] = imports;
  }
  assertEquals(
    found,
    ALLOWED,
    "packages reach the runtime through core's task objects (FileTasks, " +
      "EnvTasks, ProcessTasks, RuntimeTasks, StreamTasks, NetTasks), so only " +
      "core changes when the runtime does. Use one of those, or add what is " +
      "missing to core. If a file now imports fewer node: modules, lower its " +
      "allowance.",
  );
});
