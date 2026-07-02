/**
 * The semantic palette for {@link ConsoleTasks}: named tokens (`success`,
 * `warn`, `muted`, …) that map to concrete ANSI styles, so builds colour by
 * meaning rather than by hard-coding `[green]` everywhere. The tokens are also
 * usable inside markup — `[success]done[/]` — and a build can swap the whole
 * palette with a custom {@link Theme}.
 *
 * @module
 */

import type { StyleName } from "@zuke/core/render";

/** A mark shown before a log line: an icon plus the palette token to colour it. */
export interface LevelMark {
  /** The glyph printed before the message. */
  icon: string;
  /** The {@link Theme} token used to colour the icon. */
  token: keyof Theme;
}

/**
 * The colour palette. Each semantic token maps to the ANSI styles applied to
 * text (or markup) tagged with that name.
 */
export interface Theme {
  /** Informational messages. */
  info: StyleName[];
  /** Success/completion messages. */
  success: StyleName[];
  /** Warnings. */
  warn: StyleName[];
  /** Errors and failures. */
  error: StyleName[];
  /** Debug diagnostics. */
  debug: StyleName[];
  /** The most verbose trace output. */
  trace: StyleName[];
  /** De-emphasised, secondary text. */
  muted: StyleName[];
}

/** The default palette — a conventional terminal colour scheme. */
export const defaultTheme: Theme = {
  info: ["cyan"],
  success: ["green"],
  warn: ["yellow"],
  error: ["red"],
  debug: ["gray"],
  trace: ["dim"],
  muted: ["dim"],
};

/**
 * The icon + palette token shown before each level's messages. `success` is a
 * distinct mark that shares `info`'s severity.
 */
export const LEVEL_MARKS = {
  trace: { icon: "·", token: "trace" },
  debug: { icon: "›", token: "debug" },
  info: { icon: "ℹ", token: "info" },
  success: { icon: "✔", token: "success" },
  warn: { icon: "⚠", token: "warn" },
  error: { icon: "✖", token: "error" },
} as const satisfies Record<string, LevelMark>;

/** Expose the theme's tokens as markup tags, so `[success]…[/]` resolves. */
export function themeTags(theme: Theme): Record<string, StyleName[]> {
  return { ...theme };
}
