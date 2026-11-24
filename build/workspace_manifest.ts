// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `package.json` beside each package's `deno.json`, which makes the
 * packages an npm workspace: `npm install` at the root links each one into
 * `node_modules` under its `@zuke/<name>`, so Node, Vitest and `tsc` resolve
 * `@zuke/*` to this checkout's sources as Deno does.
 *
 * Each is generated from the package's `deno.json`, the one source of its
 * name and exports, and never edited by hand: `packageJsonSync`
 * writes them and `packageJsonSyncCheck` fails the gate when one has drifted.
 * They are private, carry no version (release-please bumps `deno.json`
 * alone, so a copy would drift on every release) and point at the TypeScript
 * sources; what npm publishes is a different manifest, which `npmBuild`
 * writes to `dist/npm`.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { parseDenoPackage } from "./npm_manifest.ts";

/** The workspace `package.json` for a package, from its parsed `deno.json`. */
export function workspaceManifest(denoJson: unknown): string {
  const pkg = parseDenoPackage(denoJson);
  return `${
    JSON.stringify(
      {
        name: pkg.name,
        private: true,
        type: "module",
        exports: pkg.exports,
      },
      null,
      2,
    )
  }\n`;
}

/** Each package's `package.json` path, and what it should hold. */
export async function workspaceManifests(
  packages: readonly string[],
): Promise<Map<string, string>> {
  const manifests = new Map<string, string>();
  for (const pkg of packages) {
    manifests.set(
      `packages/${pkg}/package.json`,
      workspaceManifest(await FileTasks.readJson(`packages/${pkg}/deno.json`)),
    );
  }
  return manifests;
}

/** The manifests in `wanted` whose file is missing or holds anything else. */
export async function staleManifests(
  wanted: ReadonlyMap<string, string>,
): Promise<string[]> {
  const stale: string[] = [];
  for (const [path, text] of wanted) {
    try {
      if (await FileTasks.readText(path) !== text) stale.push(path);
    } catch (error) {
      if (!FileTasks.isNotFound(error)) throw error;
      stale.push(path);
    }
  }
  return stale;
}
