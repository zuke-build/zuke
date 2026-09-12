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

/** The starter `zuke.ts`, with the build class named `name`. */
export function starterBuild(name: string): string {
  return `import { Build, run, target } from "jsr:@zuke/core@^1";

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
