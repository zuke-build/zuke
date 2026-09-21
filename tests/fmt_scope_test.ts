// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The formatter's scope, and why it is drawn where it is.
 *
 * `deno.json` is strict JSON — several build steps and tests read it with
 * `JSON.parse`, not a JSONC parser — so the reasoning cannot live beside the
 * configuration as comments. It lives here instead, where it also fails the
 * build if the scope is narrowed back.
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";

interface FmtConfig {
  fmt: { include: string[]; exclude: string[] };
}

async function fmtConfig(): Promise<FmtConfig["fmt"]> {
  const root: FmtConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  return root.fmt;
}

Deno.test("the formatter covers prose, not only code", async () => {
  // These were outside the scope for a long time, which made `deno fmt` a
  // no-op over most of what the repository actually publishes: a contributor
  // who ran the formatter on a single doc got a diff of thirty unrelated
  // files rewrapping, so the habit became not to run it there at all.
  const { include } = await fmtConfig();
  for (const path of ["docs/", "skills/", ".github/", "*.md"]) {
    assertEquals(
      include.includes(path),
      true,
      `fmt.include must cover ${path}; got: ${include.join(", ")}`,
    );
  }
});

Deno.test("release-please's changelogs are left alone", async () => {
  // Both the root changelog and the per-package ones are written by
  // release-please on every release. Formatting one is undone by the next cut,
  // so the gate would fail on a release PR for a file no human wrote — which
  // is the same shape of trap that broke the last one.
  const { exclude } = await fmtConfig();
  for (const path of ["CHANGELOG.md", "packages/*/CHANGELOG.md"]) {
    assertEquals(
      exclude.includes(path),
      true,
      `fmt.exclude must cover ${path}; got: ${exclude.join(", ")}`,
    );
  }
});

Deno.test("deno.json stays parseable as strict JSON", async () => {
  // Not a style rule: build/core_floor.ts, build/packages.ts and several tests
  // read these files with JSON.parse, which rejects the comments and trailing
  // commas Deno itself would accept. A JSONC-only deno.json fails those at a
  // distance, with a parse error that names neither the comment nor the file
  // that introduced it.
  for (const path of ["deno.json", "packages/core/deno.json"]) {
    const text = await Deno.readTextFile(path);
    JSON.parse(text); // throws, failing the test, if it is JSONC-only
  }
});
