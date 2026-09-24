// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The fluent {@link QrSettings} every `QrTasks` method is configured with:
 * how the text is encoded (error-correction level and boosting) and how the
 * symbol is drawn for a terminal (quiet zone, inverted colours, half-block or
 * full-block cells).
 *
 * @module
 */

import {
  ERROR_CORRECTION_LEVELS,
  type ErrorCorrectionLevel,
} from "./tables.ts";

/** The widest quiet zone accepted; the specification asks for 4. */
export const MAX_QUIET_ZONE = 16;

/**
 * Configuration for encoding and rendering a QR code, set through a lambda
 * passed to a `QrTasks` method. Every setter returns `this` so calls chain.
 */
export class QrSettings {
  /** The requested error-correction level (default `"M"`). */
  errorCorrection_: ErrorCorrectionLevel = "M";
  /** Raise the level for free when the chosen version has room (default `true`). */
  boostErrorCorrection_ = true;
  /** Light modules drawn around the symbol, in modules (default 2; the spec asks for 4). */
  quietZone_ = 2;
  /** Draw dark modules as spaces and light ones as blocks (default `false`). */
  invert_ = false;
  /** Pack two module rows into one text line with half-block characters (default `true`). */
  compact_ = true;

  /** Set the error-correction level: `"L"` (~7%), `"M"` (~15%), `"Q"` (~25%) or `"H"` (~30%). */
  errorCorrection(level: ErrorCorrectionLevel): this {
    // A build often takes the level from a string parameter, and `deno run`
    // does not type-check, so refuse anything but the four levels here.
    if (!ERROR_CORRECTION_LEVELS.includes(level)) {
      throw new RangeError(
        `errorCorrection must be one of L, M, Q or H, got ${
          JSON.stringify(level)
        }`,
      );
    }
    this.errorCorrection_ = level;
    return this;
  }

  /**
   * Whether to raise the error-correction level when a higher one fits the
   * same version. On by default; turn it off to get exactly the level asked for.
   */
  boostErrorCorrection(enabled = true): this {
    this.boostErrorCorrection_ = enabled;
    return this;
  }

  /** Set the width of the light border around the symbol, in modules (0 to {@link MAX_QUIET_ZONE}). */
  quietZone(modules: number): this {
    if (!Number.isInteger(modules) || modules < 0 || modules > MAX_QUIET_ZONE) {
      throw new RangeError(
        `quietZone must be an integer from 0 to ${MAX_QUIET_ZONE}, got ${modules}`,
      );
    }
    this.quietZone_ = modules;
    return this;
  }

  /**
   * Swap the colours: light modules become blocks and dark ones spaces. Use it
   * on a terminal whose text is light on dark, where the default rendering
   * shows the code with dark and light exchanged.
   */
  invert(enabled = true): this {
    this.invert_ = enabled;
    return this;
  }

  /**
   * Whether to draw two module rows per line with `▀`/`▄`/`█` (the default,
   * which keeps a version-3 code under 20 lines) or one row per line with a
   * two-character `██` cell per module.
   */
  compact(enabled = true): this {
    this.compact_ = enabled;
    return this;
  }
}
