// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Zuke ASCII logo and its terminal rendering: the raw art and a pure
 * line-renderer, so everything that shows the wordmark renders the same art
 * the same way.
 *
 * It lives in core because core is what executes a build, and a project
 * depends on core alone — `@zuke/console` may not be installed at all. Core
 * cannot import console (console depends on core), so the art has to be here.
 *
 * `@zuke/console` carries an identical copy for the moment. It cannot import
 * this one yet: `coreFloorCheck` type-checks every package against the exact
 * minimum of its declared core range, resolved from JSR, and no published core
 * exports this module — so the floor bump has to be a later PR, the pattern
 * `docs/versioning.md` records as `d8f51c0`. Until then
 * `packages/console/tests/logo_drift_test.ts` asserts the two constants are
 * identical, so the copies cannot drift apart.
 *
 * @module
 */

import { type StyleName, stylize } from "./render.ts";

/* cspell:disable */

/**
 * The Zuke wordmark in FIGlet's ANSI-shadow style. Solid `█` blocks form the
 * letters; box-drawing characters draw the shadow.
 */
export const ZUKE_LOGO = `███████╗██╗   ██╗██╗  ██╗███████╗
╚══███╔╝██║   ██║██║ ██╔╝██╔════╝
  ███╔╝ ██║   ██║█████╔╝ █████╗
 ███╔╝  ██║   ██║██╔═██╗ ██╔══╝
███████╗╚██████╔╝██║  ██╗███████╗
╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝`;

/* cspell:enable */

/** Options for {@link logoLines} and `ConsoleTasks.logo`. */
export interface LogoOptions {
  /** A line printed dimmed under the art (e.g. a version or strapline). */
  tagline?: string;
  /** Styles for the solid letter blocks. Defaults to `["cyan", "bold"]`. */
  letterStyle?: readonly StyleName[];
  /** Styles for the shadow characters. Defaults to `["dim"]`. */
  shadowStyle?: readonly StyleName[];
}

/** The characters that form the letters (everything else is shadow). */
const LETTER_CHARS = /[█]+/g;

/**
 * Paint one art line two-tone: letter blocks in `letters`, the rest (the
 * box-drawing shadow) in `shadow`. With `color` off the line passes through.
 */
function paintLine(
  color: boolean,
  line: string,
  letters: readonly StyleName[],
  shadow: readonly StyleName[],
): string {
  if (!color) return line;
  let out = "";
  let last = 0;
  for (const match of line.matchAll(LETTER_CHARS)) {
    const start = match.index;
    if (start > last) {
      out += stylize(true, shadow, line.slice(last, start));
    }
    out += stylize(true, letters, match[0]);
    last = start + match[0].length;
  }
  if (last < line.length) out += stylize(true, shadow, line.slice(last));
  return out;
}

/**
 * The logo as printable lines: the {@link ZUKE_LOGO} art painted two-tone when
 * `color` is on (letters bright, shadow dimmed), plus the optional tagline.
 * Pure — no I/O and no environment reads — so callers that manage their own
 * output (like the `zuke` CLI) can route the lines through any sink.
 */
export function logoLines(color: boolean, options: LogoOptions = {}): string[] {
  const letters = options.letterStyle ?? ["cyan", "bold"];
  const shadow = options.shadowStyle ?? ["dim"];
  const lines = ZUKE_LOGO.split("\n").map((line) =>
    paintLine(color, line, letters, shadow)
  );
  if (options.tagline !== undefined) {
    lines.push(stylize(color, ["dim"], options.tagline));
  }
  return lines;
}
