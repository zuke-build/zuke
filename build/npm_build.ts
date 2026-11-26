// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Compiles every package for npm into `dist/npm/<name>/`, each one ready for
 * `npm publish`: compiled `.js` and `.d.ts`, a generated `package.json`, the
 * package's README and the repository LICENSE.
 *
 * The compiler is `tsc` 7 (the native one), run on all packages as one program
 * so each `@zuke/*` specifier resolves to a source file through `paths`. The
 * sources are Deno TypeScript, so the program also needs `@types/node` and
 * `@types/deno`. Deno's own npm cache keeps no `node_modules` layout for a
 * compiler to find them in, so the three are installed with `npm ci` from the
 * committed lock (`build/npm_toolchain`, which also carries sigstore-js, for
 * the script of `npm_verify_script.ts`) into a scratch directory under
 * {@link TOOLS_ROOT} that also holds the generated tsconfig. Every machine that runs the gate has Node and npm.
 */

import {
  type AbsolutePath,
  FileTasks,
  repoRoot,
  RuntimeTasks,
} from "@zuke/core";
import { NpmTasks } from "@zuke/npm";
import { TscTasks } from "@zuke/tsc";
import {
  NPM_BIN_FILE,
  NPM_BIN_PACKAGE,
  NPM_BIN_SOURCE,
  npmManifest,
  parseDenoPackage,
  shortName,
} from "./npm_manifest.ts";
import { VERIFY_BUNDLE_SCRIPT } from "./npm_verify_script.ts";
import { TOOLS_ROOT } from "./publish.ts";

/** Where the compiled packages go, one directory per package. */
export const NPM_DIST: AbsolutePath = repoRoot("dist", "npm");

/**
 * The compiler and the ambient types it needs: a `package.json` pinning them
 * exactly and the `package-lock.json` that pins everything under them, both
 * committed. They are installed with `npm ci`, so every run checks the
 * registry's tarballs against the lock's integrity hashes.
 */
const TOOLCHAIN: AbsolutePath = repoRoot("build", "npm_toolchain");

/** The compiler options every package is built with. */
const COMPILER_OPTIONS = {
  target: "es2023",
  module: "esnext",
  moduleResolution: "bundler",
  rewriteRelativeImportExtensions: true,
  allowImportingTsExtensions: true,
  declaration: true,
  // The emit's line endings would otherwise follow the OS (CRLF on Windows),
  // and the published bytes must not depend on the machine that built them.
  newLine: "lf",
  strict: true,
  skipLibCheck: true,
  erasableSyntaxOnly: true,
  lib: ["esnext", "dom", "dom.iterable", "dom.asynciterable"],
  types: ["node", "deno"],
};

/** The scratch directory the toolchain is installed in, and the tsconfig written. */
export const NPM_TOOLS: AbsolutePath = TOOLS_ROOT("npm-tsc");

/**
 * The tsconfig that compiles `packages`, given each one's `deno.json` as
 * parsed JSON. `root` is the directory holding the package directories and
 * `out` where the output goes; the output mirrors the sources under `root`.
 */
export function npmTsconfig(
  configs: readonly unknown[],
  root: string,
  out: string,
): Record<string, unknown> {
  const paths: Record<string, string[]> = {};
  const files: string[] = [];
  for (const json of configs) {
    const pkg = parseDenoPackage(json);
    const short = shortName(pkg.name);
    for (const [key, source] of Object.entries(pkg.exports)) {
      const file = `${root}/${short}/${source.replace(/^\.\//, "")}`;
      paths[pkg.name + key.slice(1)] = [file];
      files.push(file);
    }
  }
  return {
    compilerOptions: { ...COMPILER_OPTIONS, rootDir: root, outDir: out, paths },
    files,
  };
}

/** Install the toolchain (and the sigstore verifier script) into {@link NPM_TOOLS} with `npm ci`. */
export async function installNpmToolchain(): Promise<void> {
  await FileTasks.createDirectory(NPM_TOOLS);
  for (const file of ["package.json", "package-lock.json"]) {
    await FileTasks.copy(TOOLCHAIN(file), NPM_TOOLS(file));
  }
  await FileTasks.writeText(
    NPM_TOOLS("verify_bundle.mjs"),
    VERIFY_BUNDLE_SCRIPT,
  );
  await NpmTasks.ci((s) => s.cwd(NPM_TOOLS).ignoreScripts().noAudit().noFund());
}

/**
 * Compile `packages` into `dist` (by default {@link NPM_DIST}), replacing what
 * is there.
 */
export async function buildNpm(
  packages: readonly string[],
  dist: AbsolutePath = NPM_DIST,
): Promise<void> {
  const configs = await Promise.all(
    packages.map((pkg) => FileTasks.readJson(`packages/${pkg}/deno.json`)),
  );
  const tools = NPM_TOOLS;
  await installNpmToolchain();
  await FileTasks.remove(dist, { recursive: true });
  await FileTasks.createDirectory(dist);
  const config = tools("tsconfig.json");
  await FileTasks.writeText(
    config,
    JSON.stringify(
      npmTsconfig(configs, String(repoRoot("packages")), String(dist)),
      null,
      2,
    ),
  );
  const onWindows = RuntimeTasks.os() === "windows";
  await TscTasks.tsc((s) =>
    s.toolPath(tools("node_modules", ".bin", onWindows ? "tsc.cmd" : "tsc"))
      .project(config)
  );
  for (const [index, pkg] of packages.entries()) {
    const out = dist(pkg);
    await FileTasks.writeText(
      out("package.json"),
      JSON.stringify(npmManifest(configs[index]), null, 2) + "\n",
    );
    if (pkg === NPM_BIN_PACKAGE) {
      await FileTasks.writeText(out(NPM_BIN_FILE), NPM_BIN_SOURCE);
    }
    await FileTasks.copy(`packages/${pkg}/README.md`, out("README.md"));
    await FileTasks.copy(repoRoot("LICENSE"), out("LICENSE"));
  }
}
