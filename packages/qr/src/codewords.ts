// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * From text to codewords: the byte-mode bit stream, the smallest version that
 * fits it (optionally boosting the error-correction level within that
 * version), and the interleaved data + error-correction codeword sequence that
 * is placed into the symbol.
 *
 * @module
 */

import { generator, remainder } from "./reed_solomon.ts";
import {
  blockLayout,
  ERROR_CORRECTION_LEVELS,
  type ErrorCorrectionLevel,
  MAX_VERSION,
  MIN_VERSION,
  numDataCodewords,
  numRawDataModules,
} from "./tables.ts";

/** The byte-mode indicator, `0100`. */
const BYTE_MODE = 4;

/** Thrown when the text does not fit the largest symbol at the requested level. */
export class QrCapacityError extends Error {
  /** The error's class name, for `instanceof`-free identification. */
  override name = "QrCapacityError";

  /**
   * Build the error for a text of `bytes` UTF-8 bytes refused at `level`.
   *
   * @param bytes The UTF-8 length of the text that was refused.
   */
  constructor(
    readonly bytes: number,
    /** The error-correction level the text was refused at. */
    readonly level: ErrorCorrectionLevel,
  ) {
    super(
      `${bytes} bytes of text do not fit a QR code at error-correction ` +
        `level ${level} (version ${MAX_VERSION} is the largest symbol); ` +
        `shorten the text or lower the level.`,
    );
  }
}

/** A growable sequence of bits, most-significant first. */
class BitBuffer {
  /** The bits appended so far, each 0 or 1. */
  readonly bits: number[] = [];

  /** Append the low `count` bits of `value`, most-significant first. */
  append(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

/** The width of the byte-mode character-count field for `version`. */
function charCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** The bits a byte-mode segment of `bytes` occupies at `version`. */
function segmentBits(bytes: number, version: number): number {
  return 4 + charCountBits(version) + bytes * 8;
}

/** The version and level a text is encoded at. */
export interface Placement {
  /** The chosen symbol version (1–40). */
  version: number;
  /** The chosen error-correction level, possibly boosted. */
  level: ErrorCorrectionLevel;
}

/**
 * Pick the smallest version whose data capacity at `level` holds `bytes`
 * bytes. With `boost`, the level is then raised as far as it goes without
 * growing the version, which costs nothing and makes the print more robust.
 */
export function choosePlacement(
  bytes: number,
  level: ErrorCorrectionLevel,
  boost: boolean,
): Placement {
  let version = MIN_VERSION;
  while (numDataCodewords(version, level) * 8 < segmentBits(bytes, version)) {
    if (version === MAX_VERSION) throw new QrCapacityError(bytes, level);
    version++;
  }
  let chosen = level;
  if (boost) {
    for (const candidate of ERROR_CORRECTION_LEVELS) {
      if (
        ERROR_CORRECTION_LEVELS.indexOf(candidate) >
          ERROR_CORRECTION_LEVELS.indexOf(chosen) &&
        numDataCodewords(version, candidate) * 8 >= segmentBits(bytes, version)
      ) {
        chosen = candidate;
      }
    }
  }
  return { version, level: chosen };
}

/** The padded data codewords of `bytes` at `placement`. */
export function dataCodewords(
  bytes: Uint8Array,
  placement: Placement,
): number[] {
  const buffer = new BitBuffer();
  buffer.append(BYTE_MODE, 4);
  buffer.append(bytes.length, charCountBits(placement.version));
  for (const byte of bytes) buffer.append(byte, 8);
  const capacity = numDataCodewords(placement.version, placement.level) * 8;
  buffer.append(0, Math.min(4, capacity - buffer.bits.length));
  buffer.append(0, (8 - buffer.bits.length % 8) % 8);
  for (let pad = 0xEC; buffer.bits.length < capacity; pad ^= 0xEC ^ 0x11) {
    buffer.append(pad, 8);
  }
  const result: number[] = [];
  for (let i = 0; i < buffer.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | buffer.bits[i + j];
    result.push(byte);
  }
  return result;
}

/**
 * Split `data` into blocks, append each block's error-correction codewords,
 * and interleave the blocks into the sequence the symbol is filled with.
 */
export function interleave(
  data: readonly number[],
  placement: Placement,
): number[] {
  const { numBlocks, eccPerBlock } = blockLayout(
    placement.version,
    placement.level,
  );
  const rawCodewords = Math.floor(numRawDataModules(placement.version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLength = Math.floor(rawCodewords / numBlocks);
  const divisor = generator(eccPerBlock);
  const blocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < numBlocks; i++) {
    const length = shortBlockLength - eccPerBlock +
      (i < numShortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + length);
    offset += length;
    const ecc = remainder(block, divisor);
    if (i < numShortBlocks) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLength - eccPerBlock || j >= numShortBlocks) {
        result.push(block[i]);
      }
    });
  }
  return result;
}
