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
 * nothing, with no test failing. Its own module doc named a caller that does
 * not exist, which is what a copy nothing runs decays into.
 *
 * The reachability walk is deliberately textual rather than a call into
 * `deno info`: it needs no subprocess and no network, so it runs in the fast
 * lane every contributor already runs. {@link problemsIn} takes the packages
 * directory as an argument so the walk itself is exercised against fixture
 * trees below, rather than only against whatever this repo happens to contain.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { withTemp } from "../packages/core/tests/_temp.ts";

/** The fields of a package's `deno.json` this test reads. */
interface PackageConfig {
  /** The entrypoint map — JSR's own form, either a single path or named exports. */
  readonly exports?: string | Record<string, string>;
}

/** A module to visit, and the file that pointed at it (for the error message). */
interface Edge {
  /** The module's path, resolved from the referrer. */
  readonly path: string;
  /** What named it: an importing module, or a package's `deno.json`. */
  readonly referrer: string;
}

/**
 * Directories inside a package that ship no importable module. `tests/` is
 * excluded from the published package and its files are importers, not
 * imports — a module used only by a test is an orphan, and is meant to be
 * reported as one.
 */
const SKIP_DIRS: ReadonlySet<string> = new Set(["tests"]);

/** A file's contents, or `undefined` when it does not exist. */
async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/** Every `.ts` file a package ships, recursively, skipping {@link SKIP_DIRS}. */
async function tsFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...await tsFiles(path));
    } else if (entry.isFile && entry.name.endsWith(".ts")) found.push(path);
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
 * The relative `.ts` specifiers `source` imports or re-exports. Bare and `jsr:`
 * specifiers are deliberately ignored: they name another package, whose own
 * entrypoints are roots of this walk in their own right.
 *
 * Comments are stripped first, so a parked `// TODO: import "./x.ts"` cannot
 * pass a dead module off as reachable — the exact note someone leaves on the
 * module they just orphaned. Stripping can only remove edges, never invent
 * one, so its worst case is a live module reported as an orphan: loud, and
 * answered by the message rather than by silence.
 */
function relativeImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  const found: string[] = [];
  // Covers `from "./x.ts"` (import, export-from, type-only) and the dynamic
  // `import("./x.ts")` form.
  const pattern = /(?:from|import)\s*\(?\s*["'](\.[^"']+\.ts)["']/g;
  for (const match of code.matchAll(pattern)) found.push(match[1]);
  return found;
}

/** Each package's shipped modules and entrypoints, plus any malformed package. */
async function survey(
  packagesDir: string,
): Promise<{ modules: string[]; roots: Edge[]; problems: string[] }> {
  const modules: string[] = [];
  const roots: Edge[] = [];
  const problems: string[] = [];
  for await (const entry of Deno.readDir(packagesDir)) {
    if (!entry.isDirectory) continue;
    const dir = `${packagesDir}/${entry.name}`;
    const configPath = `${dir}/deno.json`;
    const text = await readIfPresent(configPath);
    if (text === undefined) {
      problems.push(`${dir}: no deno.json — every package declares one`);
      continue;
    }
    const config: PackageConfig = JSON.parse(text);
    if (config.exports === undefined) {
      problems.push(`${configPath}: declares no exports, so it ships nothing`);
      continue;
    }
    const paths = typeof config.exports === "string"
      ? [config.exports]
      : Object.values(config.exports);
    for (const path of paths) {
      roots.push({ path: resolve(`${dir}/x`, path), referrer: configPath });
    }
    modules.push(...await tsFiles(dir));
  }
  return { modules, roots, problems };
}

/**
 * Everything wrong with the workspace rooted at `packagesDir`: modules no
 * entrypoint reaches, specifiers that point at nothing, and packages whose
 * `deno.json` is missing or declares no entrypoint. Empty means healthy.
 */
async function problemsIn(packagesDir: string): Promise<string[]> {
  const { modules, roots, problems } = await survey(packagesDir);
  const reached = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const edge = pending.pop();
    if (edge === undefined || reached.has(edge.path)) continue;
    const source = await readIfPresent(edge.path);
    if (source === undefined) {
      // Named rather than thrown: a bare NotFound reads as a broken checkout
      // and never says which file pointed at the missing one.
      problems.push(
        `${edge.referrer}: points at ${edge.path}, which is missing`,
      );
      continue;
    }
    reached.add(edge.path);
    for (const specifier of relativeImports(source)) {
      pending.push({
        path: resolve(edge.path, specifier),
        referrer: edge.path,
      });
    }
  }
  for (const module of modules) {
    if (!reached.has(module)) {
      problems.push(`${module}: no entrypoint reaches it`);
    }
  }
  return problems.sort();
}

Deno.test("every shipped module is reachable from a package entrypoint", async () => {
  const problems = await problemsIn("packages");
  assertEquals(
    problems,
    [],
    `unreachable or malformed modules — delete an orphan, or export it from ` +
      `its package's mod.ts if it was meant to ship:\n  ${
        problems.join("\n  ")
      }`,
  );
});

/**
 * Run `fn` against a throwaway packages directory holding `files`, so the walk
 * is exercised on shapes this repo does not contain — and must not start
 * containing just to be tested.
 */
async function withFixture(
  files: Readonly<Record<string, string>>,
  fn: (packagesDir: string) => Promise<void>,
): Promise<void> {
  await withTemp(async (root) => {
    for (const [path, contents] of Object.entries(files)) {
      const full = `${root}/${path}`;
      await Deno.mkdir(full.slice(0, full.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeTextFile(full, contents);
    }
    await fn(root);
  }, { prefix: "zuke-orphan-" });
}

/** The `deno.json` of a one-entrypoint fixture package. */
const MOD_EXPORTS = `{"exports":{".":"./mod.ts"}}`;

Deno.test("a module reached only through imports is not an orphan", async () => {
  await withFixture({
    "fx/deno.json": MOD_EXPORTS,
    "fx/mod.ts": `export * from "./src/a.ts";`,
    // Reached two hops out, through a re-export and a type-only import, to
    // pin that both forms count as edges.
    "fx/src/a.ts":
      `import type { B } from "./nested/b.ts";\nexport type A = B;`,
    "fx/src/nested/b.ts": `export interface B { x: number }`,
  }, async (root) => {
    assertEquals(await problemsIn(root), []);
  });
});

Deno.test("a commented-out import does not make an orphan reachable", async () => {
  // The regression this guard exists for: parking a module behind a TODO is
  // how orphans are created, so the note must not also hide the orphan.
  await withFixture({
    "fx/deno.json": MOD_EXPORTS,
    "fx/mod.ts":
      `//  TODO: import "./src/parked.ts" once the feature lands\n/* import "./src/parked.ts" */\nexport const live = 1;`,
    "fx/src/parked.ts": `export const parked = 1;`,
  }, async (root) => {
    assertEquals(await problemsIn(root), [
      `${root}/fx/src/parked.ts: no entrypoint reaches it`,
    ]);
  });
});

Deno.test("a module reached only from a test is an orphan", async () => {
  await withFixture({
    "fx/deno.json": MOD_EXPORTS,
    "fx/mod.ts": `export const live = 1;`,
    "fx/src/helper.ts": `export const helper = 1;`,
    "fx/tests/helper_test.ts": `import "../src/helper.ts";`,
  }, async (root) => {
    assertEquals(await problemsIn(root), [
      `${root}/fx/src/helper.ts: no entrypoint reaches it`,
    ]);
  });
});

Deno.test("a specifier pointing at nothing names the file that pointed at it", async () => {
  await withFixture({
    "fx/deno.json": `{"exports":{".":"./mod.ts","./gone":"./src/gone.ts"}}`,
    "fx/mod.ts": `import "./src/missing.ts";`,
  }, async (root) => {
    assertEquals(await problemsIn(root), [
      `${root}/fx/deno.json: points at ${root}/fx/src/gone.ts, which is missing`,
      `${root}/fx/mod.ts: points at ${root}/fx/src/missing.ts, which is missing`,
    ]);
  });
});

Deno.test("a package with no deno.json or no exports is named, not skipped", async () => {
  await withFixture({
    "no-config/mod.ts": `export const x = 1;`,
    "no-exports/deno.json": `{"name":"@zuke/no-exports"}`,
  }, async (root) => {
    assertEquals(await problemsIn(root), [
      `${root}/no-config: no deno.json — every package declares one`,
      `${root}/no-exports/deno.json: declares no exports, so it ships nothing`,
    ]);
  });
});

Deno.test("a single-string exports field names one entrypoint", async () => {
  await withFixture({
    "fx/deno.json": `{"exports":"./mod.ts"}`,
    "fx/mod.ts": `export const x = 1;`,
  }, async (root) => {
    assertEquals(await problemsIn(root), []);
  });
});

Deno.test("a read failure that is not a missing file is not swallowed", async () => {
  // A directory named like a module: readTextFile fails with something other
  // than NotFound, which must surface rather than be reported as "missing".
  await withFixture(
    { "fx/deno.json": `{"exports":"./mod.ts"}` },
    async (root) => {
      await Deno.mkdir(`${root}/fx/mod.ts`);
      let raised: Error | undefined;
      try {
        await problemsIn(root);
      } catch (error) {
        raised = error instanceof Error ? error : new Error(String(error));
      }
      assertEquals(raised instanceof Deno.errors.NotFound, false);
      assertEquals(raised !== undefined, true);
    },
  );
});
