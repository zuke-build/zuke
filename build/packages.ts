// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
  "docker",
  "docker-compose",
  "kubectl",
  "helm",
  "kustomize",
  "argo-rollouts",
  "oxlint",
  "eslint",
  "cspell",
  "shellcheck",
  "jest",
  "vitest",
  "playwright",
  "cypress",
  "biome",
  "knip",
  "dpdm",
  "jsr",
  "vite",
  "storybook",
  "redocly",
  "lint-staged",
  "tsup",
  "turbo",
  "nx",
  "tsx",
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
  // After console and gh, which it depends on (PACKAGE_DEPENDENCIES).
  "cli",
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
  "qr",
  "prometheus",
  // After prometheus, which it depends on (PACKAGE_DEPENDENCIES).
  "canary",
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

/**
 * The workspace packages a package may depend on **beyond `@zuke/core`** — the
 * exemptions to the rule that a package depends on core alone (AGENTS.md,
 * guideline 12). A plain tool wrapper never appears here: it mirrors one CLI
 * and needs nothing but core. A "rich feature" package does — one that
 * orchestrates other tools rather than wrapping one, and would otherwise grow
 * a second, drifting copy of a wrapper it could call. Each entry is a decision,
 * so adding a dependency means adding it here, where review sees it; the
 * `package_dependencies_test` fails on any `@zuke/*` import not listed.
 */
export const PACKAGE_DEPENDENCIES: Readonly<
  Record<string, readonly string[]>
> = {
  // The `zuke` command: its console output and its GitHub setup steps.
  cli: ["console", "gh"],
  // The AI reviewer: its pull-request comments, reactions and the commenter
  // check go through GhTasks instead of a REST client of its own.
  ai: ["gh"],
  // The canary engine: its `prometheus(...)` analysis queries through
  // PrometheusTasks, so there is one Prometheus transport, not a second copy.
  canary: ["prometheus"],
};

/** The current version declared in `packages/<pkg>/deno.json`. */
export async function localVersion(pkg: string): Promise<string> {
  return readVersion(await FileTasks.readJson(`packages/${pkg}/deno.json`));
}
