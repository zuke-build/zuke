// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * How the global CLI paints its own output: `--version`, `--help`, and the
 * status lines `setup`, `import` and `upgrade` print.
 *
 * It mirrors the palette `@zuke/core` paints the build's own CLI with. Core
 * now exports that palette from `@zuke/core/render`, but the core-floor check
 * lets this package use a new export only once that core is released, so this
 * copy stays until then and is removed in the change that raises the floor
 * (#744).
 *
 * Whether to paint is `@zuke/core`'s {@link resolveOutputMode} — the same
 * answer the build's own CLI and the executor get — so `ZUKE_PLAIN`, `--plain`,
 * CI and a pipe mean the same thing here as in the build. Every method is the
 * identity when output is not rich, which is what keeps the plain output
 * exactly what it was before it had a rich form.
 *
 * @module
 */

import { type OutputMode, resolveOutputMode } from "@zuke/core";
import { stylize } from "@zuke/core/render";

/** How each kind of text in the CLI's own output is painted. */
export interface CliPaint {
  /** Whether output is rich (a terminal, off CI, not plain). */
  rich: boolean;
  /** Whether ANSI colour is on. */
  color: boolean;
  /**
   * Whether to open with the logo banner: off when plain output was asked for
   * (`ZUKE_PLAIN` / `--plain`), which implies no banner, or when the banner
   * itself was (`ZUKE_NO_BANNER`) — the logo `setup` opens with is this
   * command's banner. A pipe or CI is not rich either, but nobody asked it to
   * drop the banner.
   */
  banner: boolean;
  /** A section heading such as `Usage:`. */
  heading(text: string): string;
  /** A command or flag name in a help row. */
  name(text: string): string;
  /** Secondary detail. */
  muted(text: string): string;
  /** An emphasised value, such as a version. */
  value(text: string): string;
  /** A line reporting success: a green ✔ before it when rich. */
  ok(text: string): string;
  /** A line reporting failure or unfinished work: a ✖ before it when rich. */
  fail(text: string): string;
}

/** The identity palette: plain output, and every test's default. */
export const PLAIN_PAINT: CliPaint = {
  rich: false,
  color: false,
  banner: true,
  heading: (text) => text,
  name: (text) => text,
  muted: (text) => text,
  value: (text) => text,
  ok: (text) => text,
  fail: (text) => text,
};

/**
 * The palette for `mode`: {@link PLAIN_PAINT} unless output is rich. Colour
 * follows `mode.color` on its own, so `NO_COLOR` keeps the glyphs and drops the
 * escape codes.
 */
export function cliPaint(mode: OutputMode): CliPaint {
  if (!mode.rich) return { ...PLAIN_PAINT, banner: mode.banner };
  const color = mode.color;
  return {
    rich: true,
    color,
    banner: mode.banner,
    heading: (text) =>
      `${stylize(color, ["magenta"], "◆")} ${stylize(color, ["bold"], text)}`,
    name: (text) => stylize(color, ["cyan"], text),
    muted: (text) => stylize(color, ["dim"], text),
    value: (text) => stylize(color, ["green", "bold"], text),
    ok: (text) => `${stylize(color, ["green"], "✔")} ${text}`,
    fail: (text) => `${stylize(color, ["red"], "✖")} ${text}`,
  };
}

/**
 * The palette for this invocation: an explicit `--plain`, else `ZUKE_PLAIN`,
 * CI and whether stdout is a terminal, as {@link resolveOutputMode} reads them.
 */
export function invocationPaint(
  plain: boolean | undefined,
  isTerminal: (() => boolean) | undefined,
): CliPaint {
  return cliPaint(resolveOutputMode({ plain, isTerminal }));
}
