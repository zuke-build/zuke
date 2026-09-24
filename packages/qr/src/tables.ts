// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The constant tables of the QR Code specification (ISO/IEC 18004): the
 * error-correction levels with their format bits, the per-version block
 * layouts, and the derived capacities and alignment-pattern positions.
 *
 * @module
 */

/** A QR error-correction level, from `"L"` (~7% recoverable) to `"H"` (~30%). */
export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

/** The four levels in ascending order of strength. */
export const ERROR_CORRECTION_LEVELS: readonly ErrorCorrectionLevel[] = [
  "L",
  "M",
  "Q",
  "H",
];

/** The two-bit value each level contributes to the format information. */
export const FORMAT_BITS: Readonly<Record<ErrorCorrectionLevel, number>> = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2,
};

/** The smallest QR version (a 21×21 symbol). */
export const MIN_VERSION = 1;
/** The largest QR version (a 177×177 symbol). */
export const MAX_VERSION = 40;

/** Error-correction codewords per block, indexed `[level][version]` (index 0 unused). */
const ECC_CODEWORDS_PER_BLOCK: Readonly<
  Record<ErrorCorrectionLevel, readonly number[]>
> = {
  // deno-fmt-ignore
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // deno-fmt-ignore
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  // deno-fmt-ignore
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // deno-fmt-ignore
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** Number of error-correction blocks, indexed `[level][version]` (index 0 unused). */
const NUM_ERROR_CORRECTION_BLOCKS: Readonly<
  Record<ErrorCorrectionLevel, readonly number[]>
> = {
  // deno-fmt-ignore
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  // deno-fmt-ignore
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  // deno-fmt-ignore
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  // deno-fmt-ignore
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** The block layout of one version at one level. */
export interface BlockLayout {
  /** How many error-correction blocks the codewords are split into. */
  numBlocks: number;
  /** How many error-correction codewords each block carries. */
  eccPerBlock: number;
}

/** The block layout of `version` at `level`. */
export function blockLayout(
  version: number,
  level: ErrorCorrectionLevel,
): BlockLayout {
  return {
    numBlocks: NUM_ERROR_CORRECTION_BLOCKS[level][version],
    eccPerBlock: ECC_CODEWORDS_PER_BLOCK[level][version],
  };
}

/** The symbol's side length in modules for `version`. */
export function sizeOf(version: number): number {
  return version * 4 + 17;
}

/**
 * The number of modules available for data and error correction in `version`,
 * after the function patterns (finders, timing, alignment, format, version
 * information) are subtracted.
 */
export function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** The number of 8-bit data codewords `version` holds at `level`. */
export function numDataCodewords(
  version: number,
  level: ErrorCorrectionLevel,
): number {
  const { numBlocks, eccPerBlock } = blockLayout(version, level);
  return Math.floor(numRawDataModules(version) / 8) - eccPerBlock * numBlocks;
}

/**
 * The centre coordinates of the alignment patterns along one axis of
 * `version`; the full set is every pair of these, minus the three that would
 * overlap a finder pattern.
 */
export function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32
    ? 26
    : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = sizeOf(version) - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}
