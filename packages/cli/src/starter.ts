// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The files `zuke setup` scaffolds from a template: the starter build and the
 * repository-root marker. Kept apart from the scaffolder because the build
 * template is source code for the user's project — its `console.log` runs in
 * their build, not in this process — and the suite's check that nothing in
 * this package writes to the console except its sink names this module as the
 * one file that may look as if it does.
 *
 * @module
 */

/**
 * The `jsr:` dependency a scaffolded `deno.json` maps `@zuke/<name>` to.
 *
 * The caret major is what gets pinned: every Zuke package is 1.x on full
 * semver, so `@^1` takes minors and patches and stops a future major from
 * landing in a scaffolded build unannounced. One definition, so the starter
 * build and `zuke import`'s generated one cannot drift apart on it.
 */
export function zukeDependency(name: string): string {
  return `jsr:@zuke/${name}@^1`;
}

/**
 * The `deno.json` import map entries the starter build resolves through.
 *
 * The build imports `@zuke/core` by its **bare** specifier rather than writing
 * `jsr:@zuke/core@^1` inline, because Deno's default lint set (the one that
 * applies to a `deno.json` that does not configure `lint.rules`, which is
 * exactly what `setup` writes) rejects an inline `jsr:` specifier under
 * `no-import-prefix` — so a scaffold that inlined it failed `deno lint` on its
 * own first file. The pin moves to the map instead; it is not lost.
 */
export const STARTER_IMPORTS: Readonly<Record<string, string>> = {
  "@zuke/core": zukeDependency("core"),
};

/** The starter `zuke.ts`, with the build class named `name`. */
export function starterBuild(name: string): string {
  return `import { Build, run, target } from "@zuke/core";

/** Your project's build. Run a target with \`./zuke <target>\`. */
class ${name} extends Build {
  hello = target()
    .description("A sample target — replace me with real work")
    .executes(() => {
      console.log("Hello from Zuke!");
    });

  // Convention: \`default\` runs when no target is named.
  default = target()
    .description("Default target")
    .dependsOn(this.hello)
    .executes(() => {});
}

await run(${name});
`;
}

/**
 * The starter `zuke.json` config. Its presence at the repository root is what
 * `@zuke/core`'s `repoRoot()` walks up to find; the recorded `name` is the
 * build class for reference.
 */
export function starterConfig(name: string): string {
  return `${JSON.stringify({ name }, null, 2)}\n`;
}
