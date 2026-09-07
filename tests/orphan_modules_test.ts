// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Every module a package ships is reachable from that package's declared
 * entrypoints. An unreferenced module is dead weight that still type-checks,
 * still lints, and still looks live to anyone reading it — the shape AGENTS.md
 * guideline 12 warns about, because the orphan drifts from the copy that runs
 * and the drift is invisible.
 *
 * This is not hypothetical: `packages/core/src/cli_args.ts` sat here for
 * months as a stale second copy of the CLI argument parser, exporting its own
 * `parseArgs` and its own command-dispatch ladder. Adding a command meant
 * finding two plausible places to add it, only one of which the process ever
 * reaches — a change made in the wrong one would compile, lint, and do
 * nothing, with no test failing.
 *
 * The reachability walk here is deliberately textual rather than a call into
 * `deno info`: it needs no subprocess and no network, so it runs in the fast
 * lane every contributor already runs.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";

/** The fields of a package's `deno.json` this test reads. */
interface PackageConfig {
  /** The entrypoint map — JSR's own form, either a single path or named exports. */
  readonly exports?: string | Record<string, string>;
}

/** Every `.ts` file under `dir`, recursively; empty when `dir` does not exist. */
async function tsFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) found.push(...await tsFiles(path));
      else if (entry.isFile && entry.name.endsWith(".ts")) found.push(path);
    }
  } catch {
    // A package with no `src/` directory ships only its `mod.ts`.
  }
  return found;
}

/** Resolve a relative specifier against the importing file's directory. */
function resolve(from: string, specifier: string): string {
  const segments = `${from.slice(0, from.lastIndexOf("/"))}/${specifier}`
    .split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "..") out.pop();
    else if (segment !== ".") out.push(segment);
  }
  return out.join("/");
}

/**
 * The relative `.ts` specifiers `source` imports or re-exports. Bare and
 * `jsr:` specifiers are deliberately ignored: they name another package, whose
 * own entrypoints are roots of this walk in their own right.
 */
function relativeImports(source: string): string[] {
  const found: string[] = [];
  // Covers `from "./x.ts"` (import, export-from, type-only) and the dynamic
  // `import("./x.ts")` form.
  const pattern = /(?:from|import)\s*\(?\s*["'](\.[^"']+\.ts)["']/g;
  for (const match of source.matchAll(pattern)) found.push(match[1]);
  return found;
}

/** Each package's directory, its shipped modules, and its entrypoints. */
async function survey(): Promise<{ modules: string[]; roots: string[] }> {
  const modules: string[] = [];
  const roots: string[] = [];
  for await (const entry of Deno.readDir("packages")) {
    if (!entry.isDirectory) continue;
    const dir = `packages/${entry.name}`;
    const config: PackageConfig = JSON.parse(
      await Deno.readTextFile(`${dir}/deno.json`),
    );
    const exports = config.exports ?? {};
    const paths = typeof exports === "string"
      ? [exports]
      : Object.values(exports);
    for (const path of paths) roots.push(resolve(`${dir}/x`, path));
    modules.push(...await tsFiles(`${dir}/src`));
    // A package's own top-level modules (`mod.ts`, and any sibling of it);
    // `tests/` is excluded from the published package and from this walk.
    for await (const file of Deno.readDir(dir)) {
      if (file.isFile && file.name.endsWith(".ts")) {
        modules.push(`${dir}/${file.name}`);
      }
    }
  }
  return { modules, roots };
}

Deno.test("every shipped module is reachable from a package entrypoint", async () => {
  const { modules, roots } = await survey();
  const reached = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || reached.has(file)) continue;
    reached.add(file);
    const source = await Deno.readTextFile(file);
    for (const specifier of relativeImports(source)) {
      pending.push(resolve(file, specifier));
    }
  }
  const orphans = modules.filter((m) => !reached.has(m)).sort();
  assertEquals(
    orphans,
    [],
    `modules no entrypoint reaches — delete them, or export them from the ` +
      `package's mod.ts if they were meant to ship:\n  ${orphans.join("\n  ")}`,
  );
});
