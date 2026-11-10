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

import { BUILD_FIELD, BUILD_FILE } from "./build_file.ts";

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
 * build class for reference, and `build` names the build file when it is not
 * the default `zuke.ts`.
 */
export function starterConfig(name: string, buildFile: string): string {
  const build = buildFile === BUILD_FILE ? {} : { [BUILD_FIELD]: buildFile };
  return `${JSON.stringify({ name, ...build }, null, 2)}\n`;
}

/** The build file `zuke setup --sdk python` writes, which `sdk.command` runs. */
export const PYTHON_BUILD_FILE = "build.py";

/**
 * The `sdk.command` a Python scaffold's `zuke.json` names: `uv run` reads the
 * inline script metadata atop {@link starterPythonBuild} and provides the
 * `zuke` package, so the build runs with no project file of its own.
 */
export const PYTHON_SDK_COMMAND: readonly string[] = [
  "uv",
  "run",
  PYTHON_BUILD_FILE,
];

/**
 * The inline script metadata (PEP 723) every scaffolded `build.py` opens with,
 * which makes `uv run build.py` install the `zuke` SDK by itself. Shared by
 * {@link starterPythonBuild} and `zuke import`'s generated build.
 */
export const PYTHON_SCRIPT_METADATA = `# /// script
# requires-python = ">=3.12"
# dependencies = ["zuke"]
# ///
`;

/**
 * The starter `build.py`, the Python SDK's shape of {@link starterBuild}: the
 * build class named `name`, a sample target and a `default`. The script
 * metadata block makes `uv run build.py` install the SDK by itself.
 */
export function starterPythonBuild(name: string): string {
  return `${PYTHON_SCRIPT_METADATA}"""Your project's build. Run a target with ./zuke <target>."""

from zuke import Build, run, target


class ${name}(Build):
    """The targets of this project."""

    hello = (
        target()
        .description("A sample target, replace me with real work")
        .executes(lambda ctx: ctx.log("Hello from Zuke!"))
    )

    # Convention: default runs when no target is named.
    default = target().description("Default target").depends_on(hello)


run(${name})
`;
}

/**
 * The `zuke.json` of a build another SDK hosts: {@link starterConfig}'s
 * `name`, the `sdk.command` that starts the worker, and the exact
 * `@zuke/engine` release the launchers and the `zuke` command run it on.
 */
export function starterSdkConfig(name: string, engine: string): string {
  return `${
    JSON.stringify(
      { name, sdk: { command: PYTHON_SDK_COMMAND }, engine },
      null,
      2,
    )
  }\n`;
}
