// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The formatter's scope, and why it is drawn where it is.
 *
 * dprint's scope is `dprint.json`'s `includes` and `excludes`. The reasoning
 * lives here rather than beside them, where it also fails the build if the
 * scope is narrowed back. And `deno.json` stays strict JSON, since several
 * build steps and tests read it with `JSON.parse`, not a JSONC parser.
 */

import { FileTasks } from "@zuke/core";
import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";

/** The part of `dprint.json` that draws the formatter's scope. */
interface FmtScope {
  includes: string[];
  excludes: string[];
}

async function fmtConfig(): Promise<FmtScope> {
  return JSON.parse(await FileTasks.readText("dprint.json"));
}

test("the formatter covers prose, not only code", async () => {
  // These were outside the scope for a long time, which made the formatter a
  // no-op over most of what the repository actually publishes: a contributor
  // who ran the formatter on a single doc got a diff of thirty unrelated
  // files rewrapping, so the habit became not to run it there at all.
  const { includes } = await fmtConfig();
  for (const path of ["docs/**", "skills/**", ".github/**", "*.md"]) {
    assertEquals(
      includes.includes(path),
      true,
      `dprint.json includes must cover ${path}; got: ${includes.join(", ")}`,
    );
  }
});

test("release-please's changelogs are left alone", async () => {
  // Both the root changelog and the per-package ones are written by
  // release-please on every release. Formatting one is undone by the next cut,
  // so the gate would fail on a release PR for a file no human wrote — which
  // is the same shape of trap that broke the last one.
  const { excludes } = await fmtConfig();
  for (const path of ["CHANGELOG.md", "packages/*/CHANGELOG.md"]) {
    assertEquals(
      excludes.includes(path),
      true,
      `dprint.json excludes must cover ${path}; got: ${excludes.join(", ")}`,
    );
  }
});

test("deno.json stays parseable as strict JSON", async () => {
  // Not a style rule: build/core_floor.ts, build/packages.ts and several tests
  // read these files with JSON.parse, which rejects the comments and trailing
  // commas Deno itself would accept. A JSONC-only deno.json fails those at a
  // distance, with a parse error that names neither the comment nor the file
  // that introduced it.
  for (const path of ["deno.json", "packages/core/deno.json"]) {
    const text = await FileTasks.readText(path);
    JSON.parse(text); // throws, failing the test, if it is JSONC-only
  }
});
