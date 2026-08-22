// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Zuke ASCII logo and its terminal rendering: the raw art, a pure
 * line-renderer, and the plumbing `ConsoleTasks.logo` prints with. Kept in its
 * own module so anything that wants the banner — the `zuke` CLI's `setup`, a
 * build's opening splash — renders the same art the same way.
 *
 * @module
 */

import { type StyleName, stylize } from "@zuke/core/render";

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
