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
 * committed lock (`build/npm_toolchain`) into a scratch directory under
 * {@link TOOLS_ROOT} that also holds the generated tsconfig. Every machine that runs the gate has Node and npm.
 */

import { type AbsolutePath, FileTasks, repoRoot } from "@zuke/core";
import { NpmTasks } from "@zuke/npm";
import { TscTasks } from "@zuke/tsc";
import { npmManifest, parseDenoPackage, shortName } from "./npm_manifest.ts";
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
  const tools = TOOLS_ROOT("npm-tsc");
  await FileTasks.createDirectory(tools);
  for (const file of ["package.json", "package-lock.json"]) {
    await FileTasks.copy(TOOLCHAIN(file), tools(file));
  }
  await NpmTasks.ci((s) => s.cwd(tools).ignoreScripts().noAudit().noFund());
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
  const onWindows = Deno.build.os === "windows";
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
    await FileTasks.copy(`packages/${pkg}/README.md`, out("README.md"));
    await FileTasks.copy(repoRoot("LICENSE"), out("LICENSE"));
  }
}
