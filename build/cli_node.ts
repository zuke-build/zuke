// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `zuke` binary built with Node: its entry, bundled into one ES module
 * that `node --build-sea` can turn into a single executable.
 *
 * The entry is the one `build/cli_binary.ts` renders for the Deno binary,
 * which runs on either runtime, and its packages come from the same place:
 * the JSR releases, installed through JSR's npm registry (`npm.jsr.io`, where
 * `@zuke/<name>` is `@jsr/zuke__<name>`). npm itself has no `@zuke-build/engine`
 * (`NPM_EXCLUDED`), and JSR's registry rewrites every package's own imports
 * to those names, so importing them by the same names gives the bundle one
 * core that the CLI, the engine and every wrapper share.
 *
 * tsdown bundles it, installed beside the packages at a pinned release, into
 * one ES module: every dependency bundled and every dynamic import (the
 * wrappers) inlined, since a single executable carries one file. An ES
 * module because the packages use top-level await, which a CommonJS bundle
 * cannot express; a single executable runs it with `"mainFormat": "module"`.
 *
 * @module
 */

import {
  type AbsolutePath,
  absolutePath,
  FileTasks,
  ProcessTasks,
} from "@zuke/core";
import { NpmTasks } from "@zuke/npm";
import { TsdownTasks } from "@zuke/tsdown";
import { type BinaryEntry, binaryEntry } from "./cli_binary.ts";

/** The tsdown release the bundle is built with. */
const TSDOWN_VERSION = "0.23.4";

/** JSR's npm-compatible registry, which serves the `@jsr` scope. */
const JSR_NPM_REGISTRY = "https://npm.jsr.io";

/** What the Node binary's bundle is built from. */
export interface NpmEntry {
  /** The entry, importing every package by its name on JSR's npm registry. */
  readonly entry: BinaryEntry;
  /** The `package.json` dependencies: each package, at its exact release. */
  readonly dependencies: Readonly<Record<string, string>>;
}

/** `@zuke/<name>`'s name on JSR's npm registry. */
export function jsrNpmName(name: string): string {
  return `@jsr/zuke__${name}`;
}

/**
 * The Node counterpart of a release's JSR `entry`: the same packages at the
 * same releases, through JSR's npm registry. `cliVersion` is the CLI release
 * the entry imports.
 */
export function npmEntry(entry: BinaryEntry, cliVersion: string): NpmEntry {
  const dependencies: Record<string, string> = {};
  const pinned = (name: string, version: string): string => {
    dependencies[jsrNpmName(name)] = version;
    return jsrNpmName(name);
  };
  return {
    entry: {
      cli: pinned("cli", cliVersion),
      engine: pinned("engine", entry.engineVersion),
      engineVersion: entry.engineVersion,
      core: pinned("core", entry.coreVersion),
      coreVersion: entry.coreVersion,
      wrappers: entry.wrappers.map((w) => ({
        ...w,
        specifier: pinned(w.name, w.version),
      })),
    },
    dependencies,
  };
}

/** The `package.json` the bundle's packages are installed from. */
export function npmManifest(entry: NpmEntry): string {
  return `${
    JSON.stringify(
      {
        name: "zuke-binary",
        private: true,
        type: "module",
        dependencies: entry.dependencies,
        devDependencies: { tsdown: TSDOWN_VERSION },
      },
      null,
      2,
    )
  }\n`;
}

/** The `.npmrc` that sends the `@jsr` scope to JSR's npm registry. */
export const JSR_NPMRC = `@jsr:registry=${JSR_NPM_REGISTRY}\n`;

/**
 * Lets a bundled package that still calls `require` find it: an ES module has
 * none of its own.
 */
export const REQUIRE_SHIM =
  'import { createRequire as __zukeRequire } from "node:module";\n' +
  "const require = __zukeRequire(import.meta.url);";

/**
 * The tsdown configuration that bundles `entry.mjs` into `out/entry.mjs`:
 * every dependency bundled, every dynamic import inlined, so one file holds
 * the whole binary.
 */
export function tsdownConfig(): string {
  const config = {
    entry: ["entry.mjs"],
    format: "esm",
    platform: "node",
    target: "node24",
    outDir: "out",
    dts: false,
    outputOptions: { inlineDynamicImports: true },
    banner: { js: REQUIRE_SHIM },
  };
  // A RegExp has no JSON form, so it is written into the module text.
  return `export default {\n  ...${JSON.stringify(config)},\n` +
    "  deps: { alwaysBundle: [/.*/] },\n};\n";
}

/**
 * The two steps of {@link bundleNodeCli} that reach outside the process,
 * each run in the scratch directory: injectable, so the rest is testable
 * without the network or a Node.
 */
export interface BundleSteps {
  /** Install the packages `package.json` names, without their scripts. */
  install(dir: string): Promise<void>;
  /** Bundle `entry.mjs` as `tsdown.config.mjs` says, into `out/entry.mjs`. */
  bundle(dir: string): Promise<void>;
}

/** The real {@link BundleSteps}: npm, then tsdown. */
export const NPM_TSDOWN: BundleSteps = {
  install: async (dir) => {
    await NpmTasks.install((s) =>
      s.cwd(dir).ignoreScripts().noAudit().noFund()
    );
  },
  bundle: async (dir) => {
    await TsdownTasks.build((s) => s.cwd(dir).config("tsdown.config.mjs"));
  },
};

/**
 * Bundle `entry` into the single ES module at `out`: in a scratch directory,
 * write its `package.json`, `.npmrc`, entry and tsdown configuration, install
 * the packages from JSR's npm registry, bundle the entry with everything it
 * imports, and copy the result to `out`. The scratch directory is removed
 * whether it succeeds or not.
 */
export async function bundleNodeCli(
  entry: NpmEntry,
  out: AbsolutePath,
  steps: BundleSteps = NPM_TSDOWN,
): Promise<void> {
  const scratch = absolutePath(
    await FileTasks.makeTempDirectory((s) => s.prefix("zuke-node-bundle-")),
  );
  try {
    await FileTasks.writeText(scratch(".npmrc").path, JSR_NPMRC);
    await FileTasks.writeText(scratch("package.json").path, npmManifest(entry));
    await FileTasks.writeText(
      scratch("entry.mjs").path,
      binaryEntry(entry.entry),
    );
    await FileTasks.writeText(
      scratch("tsdown.config.mjs").path,
      tsdownConfig(),
    );
    await steps.install(scratch.path);
    await steps.bundle(scratch.path);
    await FileTasks.createDirectory(out.parent().path);
    await FileTasks.copy(scratch("out", "entry.mjs").path, out.path);
  } finally {
    await FileTasks.remove(scratch, { recursive: true });
  }
}

/**
 * Run the bundle at `out` with `node` (any runtime that runs an ES module
 * file given as its first argument) and `--version`, and require the first
 * line it prints to be `version`.
 *
 * @throws {Error} naming what it printed otherwise.
 */
export async function assertNodeBundleVersion(
  out: AbsolutePath,
  version: string,
  node = "node",
): Promise<void> {
  const { code, stdout } = await ProcessTasks.run(
    node,
    (s) => s.args(out.path, "--version").stdout("piped"),
  );
  const first = new TextDecoder().decode(stdout).split("\n")[0].trim();
  if (code !== 0 || first !== version) {
    throw new Error(
      `the Node bundle at ${out.path} printed "${first}" (exit ${code}) for ` +
        `--version, not ${version}`,
    );
  }
}
