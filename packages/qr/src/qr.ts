// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link QrTasks}: encode text into a QR code, render it for a terminal, or
 * print it — each configured through a {@link QrSettings} lambda.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import {
  choosePlacement,
  dataCodewords,
  interleave,
  maxBytes,
  QrCapacityError,
} from "./codewords.ts";
import { renderLines } from "./render.ts";
import { QrSettings } from "./settings.ts";
import { buildSymbol, type QrCode } from "./symbol.ts";

/** Options for {@link QrTasks.print} beyond the settings lambda. */
export interface QrPrintOptions {
  /** Where each rendered line goes (default `console.log`). */
  write?: (line: string) => void;
}

/** Encode `text` with already-resolved `settings`. */
function encodeWith(text: string, settings: QrSettings): QrCode {
  // An optional parameter left unset is `undefined` at runtime, and
  // `TextEncoder` would quietly encode it as nothing: refuse it instead.
  if (typeof text !== "string") {
    throw new TypeError(
      `QrTasks needs a string to encode, got ${
        text === undefined ? "undefined" : typeof text
      }`,
    );
  }
  // Refuse a hopeless string before encoding it: a UTF-8 encoding is never
  // shorter than the string, so a very long one would only allocate to fail.
  if (text.length > maxBytes(settings.errorCorrection_)) {
    throw new QrCapacityError(text.length, settings.errorCorrection_);
  }
  const bytes = new TextEncoder().encode(text);
  const placement = choosePlacement(
    bytes.length,
    settings.errorCorrection_,
    settings.boostErrorCorrection_,
  );
  const codewords = interleave(dataCodewords(bytes, placement), placement);
  return buildSymbol(placement.version, placement.level, codewords);
}

/** Resolve a settings lambda into a configured {@link QrSettings}. */
function settingsOf(configure: Configure<QrSettings> | undefined): QrSettings {
  return (configure ?? ((s) => s))(new QrSettings());
}

/** The surface of {@link QrTasks}. */
export interface QrTasksApi {
  /** Encode `text` (as UTF-8, byte mode) into a {@link QrCode} matrix. */
  encode(text: string, configure?: Configure<QrSettings>): QrCode;
  /** Encode `text` and render it as terminal lines (see {@link QrSettings.compact}). */
  renderLines(text: string, configure?: Configure<QrSettings>): string[];
  /** Encode `text` and render it as one newline-joined string. */
  render(text: string, configure?: Configure<QrSettings>): string;
  /** Encode `text` and write each rendered line through `options.write` (default `console.log`). */
  print(
    text: string,
    configure?: Configure<QrSettings>,
    options?: QrPrintOptions,
  ): void;
}

/**
 * Task-shaped QR code operations. Each method takes the text to encode (a URL,
 * usually) and an optional settings lambda:
 *
 * ```ts
 * import { QrTasks } from "@zuke/qr";
 *
 * QrTasks.print("https://zuke.build", (s) => s.errorCorrection("Q"));
 * ```
 */
export const QrTasks: QrTasksApi = {
  /** Encode `text` (as UTF-8, byte mode) into a {@link QrCode} matrix. */
  encode(text, configure) {
    return encodeWith(text, settingsOf(configure));
  },

  /** Encode `text` and render it as terminal lines (see {@link QrSettings.compact}). */
  renderLines(text, configure) {
    const settings = settingsOf(configure);
    return renderLines(encodeWith(text, settings), settings);
  },

  /** Encode `text` and render it as one newline-joined string. */
  render(text, configure) {
    return QrTasks.renderLines(text, configure).join("\n");
  },

  /** Encode `text` and write each rendered line through `options.write` (default `console.log`). */
  print(text, configure, options = {}) {
    const write = options.write ?? ((line: string) => console.log(line));
    for (const line of QrTasks.renderLines(text, configure)) write(line);
  },
};
