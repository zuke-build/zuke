// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `src/logo.ts` — the Zuke wordmark and its line renderer.
 *
 * These moved here from `@zuke/console` when console stopped carrying its own
 * copy of the art: the implementation is core's, so its coverage belongs with
 * it. Console keeps the tests that cover `ConsoleTasks.logo`, which is its own
 * behaviour rather than the renderer's.
 */

import { logoLines, ZUKE_LOGO } from "../src/logo.ts";
import { SGR, stripAnsi } from "../src/render.ts";
import { assertEquals, assertStringIncludes } from "./_assert.ts";

Deno.test("logoLines without colour is the raw art, line by line", () => {
  assertEquals(logoLines(false), ZUKE_LOGO.split("\n"));
});

Deno.test("logoLines with colour paints letters and shadow separately", () => {
  const lines = logoLines(true);
  assertEquals(lines.map(stripAnsi), ZUKE_LOGO.split("\n"));
  const [first] = lines;
  assertStringIncludes(first, SGR.cyan + SGR.bold);
  assertStringIncludes(first, SGR.dim);
});

Deno.test("logoLines starts a leading-shadow line with the shadow style", () => {
  // The second art line opens with box-drawing shadow, not a letter block.
  const second = logoLines(true)[1];
  assertEquals(second.startsWith(SGR.dim), true);
});

Deno.test("logoLines appends a dimmed tagline", () => {
  const plain = logoLines(false, { tagline: "v1.2.3" });
  assertEquals(plain[plain.length - 1], "v1.2.3");
  const painted = logoLines(true, { tagline: "v1.2.3" });
  assertEquals(painted[painted.length - 1], `${SGR.dim}v1.2.3${SGR.reset}`);
});

Deno.test("logoLines honours custom letter and shadow styles", () => {
  const [first] = logoLines(true, {
    letterStyle: ["magenta"],
    shadowStyle: ["gray"],
  });
  assertStringIncludes(first, SGR.magenta);
  assertStringIncludes(first, SGR.gray);
});
