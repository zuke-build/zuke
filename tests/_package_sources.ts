// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The files a package publishes, and their code without its comments, for
 * the tests that read package source for something it must not do.
 *
 * @module
 */

/** Every `.ts` file under `dir`, recursively. */
async function tsFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) found.push(...await tsFiles(path));
    else if (entry.isFile && entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

/** Every source file a package publishes: its entry point and its `src`. */
export async function packageSources(): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir("packages")) {
    if (!entry.isDirectory) continue;
    const root = `packages/${entry.name}`;
    files.push(`${root}/mod.ts`, ...await tsFiles(`${root}/src`));
  }
  return files.sort();
}

/**
 * `source` without its comments, which may say what the code must not do.
 * A pattern match, not a parse: a line comment is only dropped when it is
 * the whole line.
 */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
