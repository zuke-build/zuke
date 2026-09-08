// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A tiny library — the code under test in the `deno-library` example. The
 * build in `zuke.ts` is the interesting part; this exists so it has something
 * to format, lint, type-check and cover.
 *
 * @module
 */

/** Greet `name`, or the world when the name is blank. */
export function greet(name = ""): string {
  const who = name.trim() === "" ? "world" : name.trim();
  return `Hello, ${who}!`;
}
