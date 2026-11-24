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

/** `text` without its comments, each block comment kept as its newlines. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|\s)\/\/.*$/gm, "$1");
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
    const lines = code(await Deno.readTextFile(file)).split("\n");
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
