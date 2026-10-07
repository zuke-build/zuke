// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The palette the build CLI's informational commands (`--help`, `--list`,
 * `graph`, `--version`) are painted with.
 *
 * Every method is the identity in plain mode, which is what keeps the plain
 * output byte-for-byte what these commands printed before they had a rich
 * form: a script parsing `zuke --list`, or a test asserting it, sees no change.
 * Rich mode only ever adds — colour, and a glyph before each section heading —
 * so the words and their order are the same in both.
 *
 * Exported from `@zuke/core/render`, so the global `zuke` command paints its
 * own output with the same palette rather than a copy of it.
 *
 * @module
 */

import { stylize } from "./render.ts";
import type { OutputMode } from "./output_mode.ts";

/** How each kind of text in the CLI's informational output is painted. */
export interface CliPaint {
  /** Whether decoration (glyphs, panels) is on, as opposed to colour alone. */
  rich: boolean;
  /** Whether ANSI colour is on. */
  color: boolean;
  /** A section heading such as `Commands:`. */
  heading(text: string): string;
  /** A reserved command's name. */
  command(text: string): string;
  /** A flag or parameter, such as `--plain`. */
  flag(text: string): string;
  /** A target's name. */
  target(text: string): string;
  /** Secondary detail: dependencies, tags, hints. */
  muted(text: string): string;
  /** The program's own name in a title line. */
  brand(text: string): string;
  /** A line reporting success: a green ✔ before it when rich. */
  ok(text: string): string;
  /** A line reporting failure or unfinished work: a red ✖ before it when rich. */
  fail(text: string): string;
}

/** The glyph rich mode puts before a section heading. */
const HEADING_GLYPH = "◆";

/** Paint nothing: plain mode, and the default for every formatter. */
export const PLAIN_PAINT: CliPaint = {
  rich: false,
  color: false,
  heading: (text) => text,
  command: (text) => text,
  flag: (text) => text,
  target: (text) => text,
  muted: (text) => text,
  brand: (text) => text,
  ok: (text) => text,
  fail: (text) => text,
};

/**
 * The palette for `mode`: {@link PLAIN_PAINT} unless output is rich. Colour
 * follows `mode.color` separately, so `NO_COLOR` on a terminal still gets the
 * glyphs without the escape codes.
 */
export function cliPaint(mode: Pick<OutputMode, "rich" | "color">): CliPaint {
  if (!mode.rich) return PLAIN_PAINT;
  const color = mode.color;
  return {
    rich: true,
    color,
    heading: (text) =>
      `${stylize(color, ["magenta"], HEADING_GLYPH)} ${
        stylize(color, ["bold"], text)
      }`,
    command: (text) => stylize(color, ["cyan"], text),
    flag: (text) => stylize(color, ["yellow"], text),
    target: (text) => stylize(color, ["green", "bold"], text),
    muted: (text) => stylize(color, ["dim"], text),
    brand: (text) => stylize(color, ["cyan", "bold"], text),
    ok: (text) => `${stylize(color, ["green"], "✔")} ${text}`,
    fail: (text) => `${stylize(color, ["red"], "✖")} ${text}`,
  };
}
