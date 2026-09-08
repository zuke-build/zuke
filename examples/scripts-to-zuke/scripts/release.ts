#!/usr/bin/env -S deno run -A
// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * release.sh, rewritten with the `$` shell from `@zuke/core/shell` — and
 * nothing else. No build class, no targets: a plain script you run directly.
 *
 *   deno run -A scripts/release.ts 1.1.0
 *   deno run -A scripts/release.ts 1.1.0 --dry-run
 *
 * What you gain over bash: every interpolation is one argv entry (so a value
 * with a space or a quote can't break the command), a non-zero exit throws,
 * and `.text()` / `.lines()` / `.code()` give you typed output instead of
 * `$(...)` and `$?`.
 */
import { $ } from "jsr:@zuke/core@^1/shell";

const [version, flag] = Deno.args;
if (version === undefined) {
  console.error("usage: deno run -A scripts/release.ts <version> [--dry-run]");
  Deno.exit(2);
}

const dirty = await $`git status --porcelain`.quiet().text();
if (dirty !== "") throw new Error("release: the working tree is not clean");

await $`deno test -A`;

if (flag === "--dry-run") {
  console.log(`dry run: would tag v${version} and push`);
} else {
  await $`git tag -a ${`v${version}`} -m ${`Release ${version}`}`;
  await $`git push origin --follow-tags`;
}
