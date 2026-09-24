// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reed–Solomon error correction over GF(2⁸) with the QR polynomial 0x11D: the
 * generator for a given degree and the remainder of a data block against it,
 * which is the block's error-correction codewords.
 *
 * @module
 */

/** Multiply two field elements modulo the QR reducing polynomial. */
function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** The monic generator polynomial of `degree`, as coefficients from highest to lowest. */
export function generator(degree: number): number[] {
  const result: number[] = new Array(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = multiply(root, 2);
  }
  return result;
}

/** The error-correction codewords of `data` against `divisor` (from {@link generator}). */
export function remainder(
  data: readonly number[],
  divisor: readonly number[],
): number[] {
  const result: number[] = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i++) {
      result[i] ^= multiply(divisor[i], factor);
    }
  }
  return result;
}
