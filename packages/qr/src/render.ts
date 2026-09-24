// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Draw a {@link QrCode} as text for a terminal, with the quiet zone and
 * colour choices from {@link QrSettings}.
 *
 * @module
 */

import type { QrSettings } from "./settings.ts";
import type { QrCode } from "./symbol.ts";

/** Half-block glyphs for a (top, bottom) pair of modules; index `top * 2 + bottom`. */
const HALF_BLOCKS = [" ", "▄", "▀", "█"];

/** Whether module (`x`, `y`) of `code` is drawn as a block, honouring the border and inversion. */
function isBlock(
  code: QrCode,
  x: number,
  y: number,
  settings: QrSettings,
): boolean {
  const inside = x >= 0 && x < code.size && y >= 0 && y < code.size;
  const dark = inside && code.modules[y][x];
  return dark !== settings.invert_;
}

/** Render `code` as lines of text according to `settings`. */
export function renderLines(code: QrCode, settings: QrSettings): string[] {
  const border = settings.quietZone_;
  const from = -border;
  const to = code.size + border;
  const lines: string[] = [];
  if (settings.compact_) {
    for (let y = from; y < to; y += 2) {
      let line = "";
      for (let x = from; x < to; x++) {
        const top = isBlock(code, x, y, settings) ? 2 : 0;
        // Past the last row the pair's bottom half is off the symbol: light,
        // and so a block only when inverted.
        const bottom = y + 1 < to
          ? (isBlock(code, x, y + 1, settings) ? 1 : 0)
          : (settings.invert_ ? 1 : 0);
        line += HALF_BLOCKS[top + bottom];
      }
      lines.push(line);
    }
    return lines;
  }
  for (let y = from; y < to; y++) {
    let line = "";
    for (let x = from; x < to; x++) {
      line += isBlock(code, x, y, settings) ? "██" : "  ";
    }
    lines.push(line);
  }
  return lines;
}
