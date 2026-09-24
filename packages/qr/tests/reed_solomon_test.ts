// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for the Reed–Solomon generator and remainder over GF(2⁸). */

import { generator, remainder } from "../src/reed_solomon.ts";
import { assertEquals } from "../../core/tests/_assert.ts";

Deno.test("generator(2) is the textbook (x + α⁰)(x + α¹) polynomial", () => {
  // (x + 1)(x + 2) = x² + 3x + 2 over GF(2⁸).
  assertEquals(generator(2), [3, 2]);
});

Deno.test("generator(7) matches the specification's degree-7 polynomial", () => {
  assertEquals(generator(7), [127, 122, 154, 164, 11, 68, 117]);
});

Deno.test("remainder yields the error-correction codewords of a version 1-H block", () => {
  // The 9 data codewords of the single byte "a" at version 1, level H (checked
  // against an independent encoder).
  const data = [64, 22, 16, 236, 17, 236, 17, 236, 17];
  assertEquals(remainder(data, generator(17)), [
    44,
    24,
    185,
    63,
    139,
    189,
    210,
    157,
    175,
    142,
    59,
    203,
    206,
    16,
    128,
    65,
    190,
  ]);
});

Deno.test("remainder of the zero message is zero", () => {
  assertEquals(remainder([0, 0, 0], generator(4)), [0, 0, 0, 0]);
});
