// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for symbol assembly: the function patterns, codeword placement and
 * mask selection, checked against golden symbols from an independent encoder.
 */

import {
  choosePlacement,
  dataCodewords,
  interleave,
} from "../src/codewords.ts";
import { buildSymbol, type QrCode } from "../src/symbol.ts";
import { type ErrorCorrectionLevel, sizeOf } from "../src/tables.ts";
import { toRows, ZUKE_BUILD_M, ZUKE_L } from "./_golden.ts";
import { assertEquals } from "../../core/tests/_assert.ts";

/** Encode `text` at `level` with boosting, the way `QrTasks.encode` does. */
function encode(text: string, level: ErrorCorrectionLevel): QrCode {
  const bytes = new TextEncoder().encode(text);
  const placement = choosePlacement(bytes.length, level, true);
  return buildSymbol(
    placement.version,
    placement.level,
    interleave(dataCodewords(bytes, placement), placement),
  );
}

Deno.test("buildSymbol reproduces the golden version 1 symbol", () => {
  const code = encode("zuke", "L");
  assertEquals(code.version, 1);
  assertEquals(code.size, 21);
  assertEquals(code.errorCorrection, "H");
  assertEquals(code.mask, 7);
  assertEquals(toRows(code.modules), ZUKE_L);
});

Deno.test("buildSymbol reproduces the golden version 2 symbol with an alignment pattern", () => {
  const code = encode("https://zuke.build", "M");
  assertEquals(code.version, 2);
  assertEquals(code.errorCorrection, "Q");
  assertEquals(code.mask, 6);
  assertEquals(toRows(code.modules), ZUKE_BUILD_M);
});

Deno.test("a version 7 symbol carries the version information blocks", () => {
  // 60 bytes at H needs version 7 (version 6 holds 44 at H, version 7 64).
  const code = encode("v".repeat(60), "H");
  assertEquals(code.version, 7);
  assertEquals(code.size, sizeOf(7));
  // Version 7's 18-bit pattern is 000111110010010100; its lowest bit lands at
  // (size − 11, 0) and its transpose, both of which are read back here.
  const bits = 0b000111110010010100;
  for (let i = 0; i < 18; i++) {
    const expected = ((bits >>> i) & 1) === 1;
    const a = code.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    assertEquals(code.modules[b][a], expected, `top-right bit ${i}`);
    assertEquals(code.modules[a][b], expected, `bottom-left bit ${i}`);
  }
});

Deno.test("every finder pattern has its dark centre and separator", () => {
  const code = encode("finders", "M");
  const size = code.size;
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    assertEquals(code.modules[cy][cx], true);
    assertEquals(code.modules[cy][cx + 2], false, "ring is light");
    assertEquals(code.modules[cy][cx + 3], true, "outer ring is dark");
  }
  // Separator below the top-left finder, and the fixed dark module.
  assertEquals(code.modules[7].slice(0, 8), new Array(8).fill(false));
  assertEquals(code.modules[size - 8][8], true);
});

Deno.test("the timing patterns alternate along row and column 6", () => {
  const code = encode("timing", "L");
  for (let i = 8; i < code.size - 8; i++) {
    assertEquals(code.modules[6][i], i % 2 === 0);
    assertEquals(code.modules[i][6], i % 2 === 0);
  }
});

Deno.test("mask selection covers every pattern across a range of inputs", () => {
  // The penalty-minimising mask depends on the data; over enough inputs each
  // of the eight patterns wins at least once, so a broken mask formula would
  // surface as one that is never (or always) chosen.
  const seen = new Set<number>();
  for (let i = 0; i < 200 && seen.size < 8; i++) {
    seen.add(encode(`mask-${i}-${"ab".repeat(i % 7)}`, "L").mask);
  }
  assertEquals(seen.size, 8);
});
