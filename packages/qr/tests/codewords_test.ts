// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for version selection, the padded bit stream, and block interleaving. */

import {
  choosePlacement,
  dataCodewords,
  interleave,
  maxBytes,
  QrCapacityError,
} from "../src/codewords.ts";
import { numDataCodewords } from "../src/tables.ts";
import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";

const encode = (text: string) => new TextEncoder().encode(text);

Deno.test("choosePlacement picks the smallest version that fits", () => {
  assertEquals(choosePlacement(1, "H", false), { version: 1, level: "H" });
  // 17 bytes fill version 1-L exactly (19 codewords − 2 for mode + count).
  assertEquals(choosePlacement(17, "L", false), { version: 1, level: "L" });
  assertEquals(choosePlacement(18, "L", false), { version: 2, level: "L" });
  // The character count widens to 16 bits from version 10.
  assertEquals(choosePlacement(230, "L", false), { version: 9, level: "L" });
  assertEquals(choosePlacement(231, "L", false), { version: 10, level: "L" });
});

Deno.test("choosePlacement boosts the level when the version has room", () => {
  assertEquals(choosePlacement(1, "L", true), { version: 1, level: "H" });
  // 17 bytes at version 1 fit only L: nothing to boost to.
  assertEquals(choosePlacement(17, "L", true), { version: 1, level: "L" });
  // 14 bytes fit M (16 codewords) but not Q (13): boosted one step.
  assertEquals(choosePlacement(14, "L", true), { version: 1, level: "M" });
});

Deno.test("choosePlacement refuses text beyond version 40", () => {
  assertEquals(choosePlacement(2953, "L", false).version, 40);
  const error = assertThrows(
    () => choosePlacement(2954, "L", false),
    QrCapacityError,
    "2954 bytes",
  );
  assertEquals(error.name, "QrCapacityError");
  assertEquals(error instanceof QrCapacityError && error.bytes, 2954);
});

Deno.test("maxBytes is the byte capacity of version 40 at each level", () => {
  assertEquals(maxBytes("L"), 2953);
  assertEquals(maxBytes("M"), 2331);
  assertEquals(maxBytes("Q"), 1663);
  assertEquals(maxBytes("H"), 1273);
  assertEquals(choosePlacement(maxBytes("H"), "H", false).version, 40);
  assertThrows(
    () => choosePlacement(maxBytes("H") + 1, "H", false),
    QrCapacityError,
  );
});

Deno.test("dataCodewords writes mode, count, data, terminator and pad bytes", () => {
  assertEquals(dataCodewords(encode("a"), { version: 1, level: "H" }), [
    0x40,
    0x16,
    0x10,
    0xEC,
    0x11,
    0xEC,
    0x11,
    0xEC,
    0x11,
  ]);
});

Deno.test("dataCodewords shortens the terminator when the symbol is full", () => {
  const full = dataCodewords(encode("x".repeat(17)), {
    version: 1,
    level: "L",
  });
  assertEquals(full.length, 19);
  assertEquals(full[0], 0x41); // mode 0100, count 0001 0001 → 0x41 0x1…
  assertEquals(full[18], (0x78 << 4) & 0xFF); // the last byte's high nibble is 'x'
});

Deno.test("dataCodewords uses a 16-bit count from version 10", () => {
  const codewords = dataCodewords(encode("ab"), { version: 10, level: "L" });
  assertEquals(codewords.length, numDataCodewords(10, "L"));
  // 0100 | 0000000000000010 | 01100001 01100010 → 0x40 0x00 0x26 0x16 0x20
  assertEquals(codewords.slice(0, 5), [0x40, 0x00, 0x26, 0x16, 0x20]);
});

Deno.test("interleave appends error correction to a single block", () => {
  const data = dataCodewords(encode("a"), { version: 1, level: "H" });
  const all = interleave(data, { version: 1, level: "H" });
  assertEquals(all.length, 26);
  assertEquals(all.slice(0, 9), data);
  assertEquals(all.slice(9, 12), [44, 24, 185]);
});

Deno.test("interleave weaves short and long blocks column by column", () => {
  // Version 5-Q: 4 blocks, two of 15 data codewords and two of 16 (18 ECC each).
  const data = Array.from({ length: 62 }, (_, i) => i);
  const all = interleave(data, { version: 5, level: "Q" });
  assertEquals(all.length, 134);
  // Column 0 takes the first codeword of each block.
  assertEquals(all.slice(0, 4), [0, 15, 30, 46]);
  // Column 15 exists only in the two long blocks.
  assertEquals(all.slice(60, 62), [45, 61]);
});
