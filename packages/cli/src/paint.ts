// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * How the global CLI paints its own output: `--version`, `--help`, and the
 * status lines `setup`, `import` and `upgrade` print.
 *
 * The palette is `@zuke/core`'s — the one the build's own CLI is painted with,
 * exported from `@zuke/core/render` — so the two cannot drift apart. The CLI
 * adds one fact the build's palette has no use for: whether to open with the
 * logo, which `setup`, `import` and `--help` do.
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
import {
  type CliPaint as CorePaint,
  cliPaint as corePaint,
  PLAIN_PAINT as CORE_PLAIN,
} from "@zuke/core/render";

/** Core's palette, plus whether this command opens with the logo. */
export type CliPaint = CorePaint & {
  /**
   * Whether to open with the logo banner: off when plain output was asked for
   * (`ZUKE_PLAIN` / `--plain`), which implies no banner, or when the banner
   * itself was (`ZUKE_NO_BANNER`). A pipe or CI is not rich either, but nobody
   * asked it to drop the banner.
   */
  banner: boolean;
};

/** The identity palette: plain output, and every test's default. */
export const PLAIN_PAINT: CliPaint = { ...CORE_PLAIN, banner: true };

/**
 * The palette for `mode`: core's, with `mode.banner` beside it. Colour follows
 * `mode.color` on its own, so `NO_COLOR` keeps the glyphs and drops the escape
 * codes.
 */
export function cliPaint(mode: OutputMode): CliPaint {
  return { ...corePaint(mode), banner: mode.banner };
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
