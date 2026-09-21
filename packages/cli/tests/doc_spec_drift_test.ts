// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The two `resolveDocSpec` implementations answer identically.
 *
 * `zuke doc <spec>` is answered by `@zuke/cli`; `./zuke doc <spec>` by the
 * build's reserved `doc` command in `@zuke/core`. They are one command as far
 * as anyone typing it is concerned, and they used to disagree: the CLI
 * expanded a bare name to `jsr:@zuke/<name>` while core treated it as a path,
 * so the `zuke doc core` shorthand the help advertises reported a missing
 * module when the same words were typed at the launcher.
 *
 * Core owns the rule now. `@zuke/cli` cannot import it yet — `coreFloorCheck`
 * type-checks each package against the exact minimum of its declared core
 * range resolved from the registry, and the export is not in a published core
 * — so the copy stays until the next release, and this test is what keeps the
 * copy honest in the meantime. That is the same two-step the wordmark took,
 * and this file is the counterpart of the drift test that held it: when the
 * floor rises and the copy goes, this file goes with it, because it will then
 * be comparing a function with itself.
 *
 * The table is the interesting part. Each row is a shape the rule has to sort,
 * so a change to one implementation that misses the other is caught on the
 * shape it changed rather than on a single happy path.
 *
 * @module
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import { resolveDocSpec as coreResolve } from "../../core/src/doc_spec.ts";
import { resolveDocSpec as cliResolve } from "../mod.ts";

/** Every shape the rule distinguishes, one row each. */
const SPECS: readonly string[] = [
  // Bare names — the shorthand.
  "core",
  "deno",
  "my.pkg",
  // Scoped names — the slash is a scope, not a directory.
  "@scope/pkg",
  "@std/path",
  "@scope/my.pkg",
  // Already-resolved specifiers.
  "jsr:@zuke/deno",
  "npm:cowsay",
  "https://example.test/mod.ts",
  "file:///tmp/mod.ts",
  // Absolute paths, both platforms.
  "/abs/mod.ts",
  "C:/repo/mod.ts",
  "C:\\repo\\mod.ts",
  "\\\\server\\share",
  // Relative paths.
  "./mod.ts",
  "../up/mod.ts",
  "src/mod.ts",
  // Bare words that name a file.
  "mod.ts",
  "build.mjs",
  "deno.json",
];

Deno.test("the CLI's copy of resolveDocSpec matches core's on every shape", () => {
  const cwd = "/work";
  for (const spec of SPECS) {
    assertEquals(
      cliResolve(spec, cwd),
      coreResolve(spec, cwd),
      `resolveDocSpec disagreed on ${JSON.stringify(spec)} — the installed ` +
        `zuke and the ./zuke launcher would resolve it differently`,
    );
  }
});

Deno.test("the drift table covers each branch of the rule", () => {
  // A table that stopped exercising a branch would pass while saying nothing,
  // so assert the shapes are all still represented: a package specifier, a
  // cwd-joined path, and an untouched pass-through.
  const cwd = "/work";
  const results = SPECS.map((spec) => coreResolve(spec, cwd));
  assertEquals(results.some((r) => r.startsWith("jsr:@zuke/")), true);
  assertEquals(results.some((r) => r.startsWith("jsr:@scope/")), true);
  assertEquals(results.some((r) => r.startsWith("/work/")), true);
  assertEquals(results.includes("npm:cowsay"), true);
  assertEquals(results.includes("/abs/mod.ts"), true);
});
