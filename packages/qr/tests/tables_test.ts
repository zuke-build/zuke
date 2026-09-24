// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for the specification tables and the capacities derived from them. */

import {
  alignmentPatternPositions,
  blockLayout,
  numDataCodewords,
  numRawDataModules,
  sizeOf,
} from "../src/tables.ts";
import { assertEquals } from "../../core/tests/_assert.ts";

Deno.test("sizeOf grows by four modules per version", () => {
  assertEquals(sizeOf(1), 21);
  assertEquals(sizeOf(2), 25);
  assertEquals(sizeOf(40), 177);
});

Deno.test("numRawDataModules matches the specification at the corners", () => {
  // Version 1 has no alignment patterns, 7 gains the version blocks.
  assertEquals(numRawDataModules(1), 208);
  assertEquals(numRawDataModules(2), 359);
  assertEquals(numRawDataModules(7), 1568);
  assertEquals(numRawDataModules(40), 29648);
});

Deno.test("numDataCodewords reproduces Table 7 of the specification", () => {
  assertEquals(numDataCodewords(1, "L"), 19);
  assertEquals(numDataCodewords(1, "H"), 9);
  assertEquals(numDataCodewords(5, "Q"), 62);
  assertEquals(numDataCodewords(40, "L"), 2956);
  assertEquals(numDataCodewords(40, "H"), 1276);
});

Deno.test("blockLayout reads both tables at the same index", () => {
  assertEquals(blockLayout(5, "Q"), { numBlocks: 4, eccPerBlock: 18 });
  assertEquals(blockLayout(40, "H"), { numBlocks: 81, eccPerBlock: 30 });
});

Deno.test("alignmentPatternPositions follows the specification's spacing", () => {
  assertEquals(alignmentPatternPositions(1), []);
  assertEquals(alignmentPatternPositions(2), [6, 18]);
  assertEquals(alignmentPatternPositions(7), [6, 22, 38]);
  // Version 32 is the one irregular step in Annex E.
  assertEquals(alignmentPatternPositions(32), [6, 34, 60, 86, 112, 138]);
  assertEquals(alignmentPatternPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});
