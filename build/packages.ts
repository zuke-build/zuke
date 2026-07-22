/**
 * Workspace package metadata: the ordered package list and the helpers that
 * read each package's entrypoints and declared version from its `deno.json`.
 */

import { FileTasks } from "@zuke/core";

/** Workspace packages, in dependency order: core must publish before the rest. */
export const PACKAGES = [
  "core",
  "deno",
  "docs",
  "npm",
  "npx",
  "bun",
  "pnpm",
  "yarn",
  "cmd",
  "console",
  "cli",
  "docker",
  "docker-compose",
  "kubectl",
  "helm",
  "kustomize",
  "oxlint",
  "eslint",
  "cspell",
  "jest",
  "vitest",
  "playwright",
  "cypress",
  "biome",
  "knip",
  "dpdm",
  "jsr",
  "vite",
  "tsup",
  "turbo",
  "nx",
  "tsx",
  "tsgo",
  "tsc",
  "tsc-alias",
  "tsdown",
  "nest",
  "openapi-ts",
  "orval",
  "husky",
  "node",
  "dprint",
  "gcloud",
  "git",
  "gh",
  "codecov",
  "claude",
  "codex",
  "gemini",
  "terraform",
  "tofu",
  "release-please",
  "security",
  "ai",
  "otel",
];

/** A package's export entrypoints (resolved from its `deno.json` `exports`). */
export async function packageEntrypoints(dir: string): Promise<string[]> {
  const json = await FileTasks.readText(`packages/${dir}/deno.json`);
  const exportsField: unknown = JSON.parse(json).exports;
  const specs: string[] = [];
  if (typeof exportsField === "string") {
    specs.push(exportsField);
  } else if (exportsField !== null && typeof exportsField === "object") {
    for (const value of Object.values(exportsField)) {
      if (typeof value === "string") specs.push(value);
    }
  }
  return specs.map((p) => `packages/${dir}/${p.replace(/^\.\//, "")}`);
}

/** Validate and return the `version` field of a parsed `deno.json`. */
export function readVersion(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    throw new Error("deno.json must be a JSON object.");
  }
  if (!("version" in value)) {
    throw new Error('deno.json is missing a "version" field.');
  }
  if (typeof value.version !== "string") {
    throw new Error('deno.json "version" must be a string.');
  }
  return value.version;
}

/** The current version declared in `packages/<pkg>/deno.json`. */
export async function localVersion(pkg: string): Promise<string> {
  return readVersion(await FileTasks.readJson(`packages/${pkg}/deno.json`));
}
