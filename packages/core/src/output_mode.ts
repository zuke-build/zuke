// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * How decorated Zuke's console output should be: rich, plain, and whether a
 * run opens with its banner.
 *
 * There are three levels, each implying the one below it:
 *
 * - **Rich**, the default on an interactive terminal: colour, panels, glyphs.
 * - **No banner** (`ZUKE_NO_BANNER=1` / `--no-banner`): a run skips its opening
 *   banner. Nothing else changes.
 * - **Plain** (`ZUKE_PLAIN=1` / `--plain`): no banner and no colour, and the
 *   informational commands drop their decoration, printing the same text they
 *   print into a pipe — so `zuke --version` is a bare number. A run's own
 *   structure (its target rules and closing summary table) is the run's
 *   output, not decoration, and stays.
 *
 * Rich output also needs somewhere to be rich. On CI, or when stdout is not a
 * terminal (piped or redirected), the decoration is dropped automatically, so a
 * runner log or a `| grep` never has to filter it out. That automatic fallback
 * does not touch the banner: a runner log is exactly where a run's version,
 * platform and id are worth a line, which is why the banner module prints them
 * on CI in the first place.
 *
 * One resolver, shared by the build's CLI and the executor — and exported so
 * the global `@zuke/cli` can share it rather than keep a copy — so they cannot
 * come to disagree about what `ZUKE_PLAIN` means.
 *
 * @module
 */

import { defaultReadEnv, envFlag } from "./internal.ts";
import { isCI } from "./host.ts";

/** The environment variable that asks for plain output. */
export const PLAIN_ENV = "ZUKE_PLAIN";

/** The environment variable that turns off a run's opening banner. */
export const NO_BANNER_ENV = "ZUKE_NO_BANNER";

/** What {@link resolveOutputMode} decides. */
export interface OutputMode {
  /**
   * Decorate informational output — panels, glyphs, coloured headings. Only on
   * an interactive terminal that is not CI, and never when plain.
   */
  rich: boolean;
  /** Emit ANSI colour: a terminal, `NO_COLOR` unset, and not plain. */
  color: boolean;
  /** Print a run's opening banner: not plain, and not turned off. */
  banner: boolean;
}

/** Inputs to {@link resolveOutputMode}; every field has a real default. */
export interface OutputModeOptions {
  /**
   * An explicit `--plain`. Wins over `ZUKE_PLAIN` in both directions, the way
   * every explicit flag here wins over a standing preference in the shell.
   */
  plain?: boolean;
  /**
   * An explicit banner choice (`--no-banner` is `false`). Wins over
   * `ZUKE_NO_BANNER`, but never over plain: plain means no banner.
   */
  banner?: boolean;
  /** Reads an environment variable; defaults to the process environment. */
  readEnv?: (name: string) => string | undefined;
  /** Whether stdout is an interactive terminal; defaults to asking Deno. */
  isTerminal?: () => boolean;
}

/** Whether stdout is a terminal. */
function stdoutIsTerminal(): boolean {
  return Deno.stdout.isTerminal();
}

/**
 * Decide how decorated output should be, from the explicit flags and the
 * environment. Pure apart from its two injectable reads.
 *
 * What counts as a set variable is {@link envFlag}'s business, so
 * `ZUKE_PLAIN=false` and `ZUKE_PLAIN=0` mean "not plain". `NO_COLOR` follows its
 * own convention instead: any non-empty value turns colour off.
 */
export function resolveOutputMode(
  options: OutputModeOptions = {},
): OutputMode {
  const readEnv = options.readEnv ?? defaultReadEnv;
  const terminal = (options.isTerminal ?? stdoutIsTerminal)();
  const plain = options.plain ?? envFlag(readEnv(PLAIN_ENV));
  const noColor = (readEnv("NO_COLOR") ?? "") !== "";
  return {
    rich: !plain && terminal && !isCI(readEnv),
    color: !plain && terminal && !noColor,
    banner: !plain &&
      (options.banner ?? !envFlag(readEnv(NO_BANNER_ENV))),
  };
}
