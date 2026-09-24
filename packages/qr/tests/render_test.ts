// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for the terminal renderer: half blocks, full blocks, borders, inversion. */

import { renderLines } from "../src/render.ts";
import { QrSettings } from "../src/settings.ts";
import type { QrCode } from "../src/symbol.ts";
import { assertEquals } from "../../core/tests/_assert.ts";

/** A fake 3×3 "code" whose modules spell a diagonal, enough to see every glyph. */
function diagonal(size: number): QrCode {
  return {
    version: 1,
    size,
    errorCorrection: "L",
    mask: 0,
    modules: Array.from(
      { length: size },
      (_, y) => Array.from({ length: size }, (_, x) => x === y),
    ),
  };
}

Deno.test("compact rendering packs two rows per line with half blocks", () => {
  const lines = renderLines(diagonal(2), new QrSettings().quietZone(0));
  // Row 0 = [dark, light], row 1 = [light, dark]: top-half, bottom-half.
  assertEquals(lines, ["▀▄"]);
});

Deno.test("compact rendering treats a missing last row as light", () => {
  const lines = renderLines(diagonal(3), new QrSettings().quietZone(0));
  assertEquals(lines, ["▀▄ ", "  ▀"]);
});

Deno.test("compact rendering with a border pads the last line with light modules", () => {
  const lines = renderLines(diagonal(2), new QrSettings().quietZone(1));
  // 4 rows in pairs: (border, row 0), (row 1, border).
  assertEquals(lines, [" ▄  ", "  ▀ "]);
});

Deno.test("inverting swaps dark and light, including the border and the missing row", () => {
  const lines = renderLines(
    diagonal(3),
    new QrSettings().quietZone(0).invert(),
  );
  assertEquals(lines, ["▄▀█", "██▄"]);
});

Deno.test("full-block rendering draws one row per line with two-character cells", () => {
  const lines = renderLines(
    diagonal(2),
    new QrSettings().quietZone(1).compact(false),
  );
  assertEquals(lines, [
    "        ",
    "  ██    ",
    "    ██  ",
    "        ",
  ]);
});

Deno.test("full-block rendering honours inversion", () => {
  const lines = renderLines(
    diagonal(2),
    new QrSettings().quietZone(0).compact(false).invert(),
  );
  assertEquals(lines, ["  ██", "██  "]);
});
