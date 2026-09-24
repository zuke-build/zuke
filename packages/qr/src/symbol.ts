// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The symbol itself: a module matrix with the function patterns drawn, the
 * codewords placed in the zigzag order, and the mask chosen by the
 * specification's penalty score.
 *
 * @module
 */

import {
  alignmentPatternPositions,
  type ErrorCorrectionLevel,
  FORMAT_BITS,
  sizeOf,
} from "./tables.ts";

/** A finished QR code, as the caller sees it. */
export interface QrCode {
  /** The symbol version (1–40). */
  readonly version: number;
  /** The side length in modules (`version * 4 + 17`). */
  readonly size: number;
  /** The error-correction level actually used (boosting can raise the requested one). */
  readonly errorCorrection: ErrorCorrectionLevel;
  /** The mask pattern (0–7) the penalty score selected. */
  readonly mask: number;
  /** The modules, `modules[y][x]`, `true` for dark. */
  readonly modules: readonly (readonly boolean[])[];
}

/** Penalty weights from the specification. */
const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** The bit `i` of `value`, as a boolean. */
function bit(value: number, i: number): boolean {
  return ((value >>> i) & 1) !== 0;
}

/** The mask condition for pattern `mask` at module (`x`, `y`). */
function masked(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return (x * y) % 2 + (x * y) % 3 === 0;
    case 6:
      return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    default:
      return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
  }
}

/** A mutable symbol under construction. */
class Symbol_ {
  /** The side length in modules. */
  readonly size: number;
  /** `modules[y][x]`, `true` for dark. */
  readonly modules: boolean[][];
  /** `isFunction[y][x]`, `true` where a function pattern owns the module. */
  readonly isFunction: boolean[][];

  constructor(readonly version: number, readonly level: ErrorCorrectionLevel) {
    this.size = sizeOf(version);
    this.modules = Array.from(
      { length: this.size },
      () => new Array<boolean>(this.size).fill(false),
    );
    this.isFunction = Array.from(
      { length: this.size },
      () => new Array<boolean>(this.size).fill(false),
    );
  }

  /** Set a function module, marking it as owned. */
  setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  /** Draw every function pattern; the format bits get a placeholder mask. */
  drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const positions = alignmentPatternPositions(this.version);
    const last = positions.length - 1;
    positions.forEach((y, i) => {
      positions.forEach((x, j) => {
        const nearFinder = (i === 0 && j === 0) || (i === 0 && j === last) ||
          (i === last && j === 0);
        if (!nearFinder) this.drawAlignment(x, y);
      });
    });
    this.drawFormatBits(0);
    this.drawVersion();
  }

  /** A 7×7 finder pattern centred on (`x`, `y`) with its separator ring. */
  private drawFinder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunction(xx, yy, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  /** A 5×5 alignment pattern centred on (`x`, `y`). */
  private drawAlignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunction(
          x + dx,
          y + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
        );
      }
    }
  }

  /** Write the format information (level + `mask`) in both of its locations. */
  drawFormatBits(mask: number): void {
    const data = (FORMAT_BITS[this.level] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(bits, i));
    this.setFunction(8, 7, bit(bits, 6));
    this.setFunction(8, 8, bit(bits, 7));
    this.setFunction(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) {
      this.setFunction(this.size - 1 - i, 8, bit(bits, i));
    }
    for (let i = 8; i < 15; i++) {
      this.setFunction(8, this.size - 15 + i, bit(bits, i));
    }
    this.setFunction(8, this.size - 8, true);
  }

  /** Write the version information blocks (versions 7 and up only). */
  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const value = bit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, value);
      this.setFunction(b, a, value);
    }
  }

  /** Place the codewords in the zigzag order, skipping function modules. */
  drawCodewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < this.size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vertical : vertical;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  /** XOR the data modules with `mask`; applying it twice restores the original. */
  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isFunction[y][x] && masked(mask, x, y)) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  }

  /** Apply each mask in turn and keep the one with the lowest penalty. */
  chooseMask(): number {
    let best = 0;
    let bestPenalty = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask++) {
      this.applyMask(mask);
      this.drawFormatBits(mask);
      const penalty = this.penalty();
      if (penalty < bestPenalty) {
        best = mask;
        bestPenalty = penalty;
      }
      this.applyMask(mask);
    }
    this.applyMask(best);
    this.drawFormatBits(best);
    return best;
  }

  /** The specification's penalty score of the current module pattern. */
  private penalty(): number {
    let result = 0;
    for (let y = 0; y < this.size; y++) {
      result += this.runPenalty((x) => this.modules[y][x]);
    }
    for (let x = 0; x < this.size; x++) {
      result += this.runPenalty((y) => this.modules[y][x]);
    }
    let dark = 0;
    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const color = this.modules[y][x];
        if (
          color === this.modules[y][x + 1] &&
          color === this.modules[y + 1][x] &&
          color === this.modules[y + 1][x + 1]
        ) {
          result += PENALTY_N2;
        }
      }
    }
    for (const row of this.modules) {
      for (const module of row) if (module) dark++;
    }
    const total = this.size * this.size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * PENALTY_N4;
  }

  /** The run-length and finder-like penalties along one line of modules. */
  private runPenalty(at: (i: number) => boolean): number {
    let result = 0;
    let runColor = false;
    let runLength = 0;
    const history: number[] = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < this.size; i++) {
      if (at(i) === runColor) {
        runLength++;
        if (runLength === 5) result += PENALTY_N1;
        else if (runLength > 5) result++;
      } else {
        this.addRunHistory(runLength, history);
        if (!runColor) result += finderLikePatterns(history) * PENALTY_N3;
        runColor = at(i);
        runLength = 1;
      }
    }
    if (runColor) {
      this.addRunHistory(runLength, history);
      runLength = 0;
    }
    this.addRunHistory(runLength + this.size, history);
    return result + finderLikePatterns(history) * PENALTY_N3;
  }

  /** Push a run onto the history; the first light run is padded by a quiet zone. */
  private addRunHistory(runLength: number, history: number[]): void {
    const padded = history[0] === 0 ? runLength + this.size : runLength;
    history.pop();
    history.unshift(padded);
  }
}

/** How many `1:1:3:1:1` finder-like sequences the run history ends with. */
function finderLikePatterns(history: readonly number[]): number {
  const n = history[1];
  const core = n > 0 && history[2] === n && history[3] === n * 3 &&
    history[4] === n && history[5] === n;
  return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
    (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
}

/** Assemble the symbol for `codewords` at `version`/`level`. */
export function buildSymbol(
  version: number,
  level: ErrorCorrectionLevel,
  codewords: readonly number[],
): QrCode {
  const symbol = new Symbol_(version, level);
  symbol.drawFunctionPatterns();
  symbol.drawCodewords(codewords);
  const mask = symbol.chooseMask();
  return {
    version,
    size: symbol.size,
    errorCorrection: level,
    mask,
    modules: symbol.modules,
  };
}
