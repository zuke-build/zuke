// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/qr` — QR codes for any data, from a Zuke build, with no dependency.
 *
 * Encode any text a scanner should pick up — a URL, a Wi-Fi or login string, a
 * one-time token, a JSON payload — and print it in the terminal, keep it as
 * text, or take the raw module matrix and draw it yourself (an SVG, a PNG, a
 * slide):
 *
 * ```ts
 * import { Build, parameter, run, target } from "@zuke/core";
 * import { QrTasks } from "@zuke/qr";
 *
 * class Release extends Build {
 *   url = parameter("the page to encode").required();
 *   qr = target().executes(() => {
 *     QrTasks.print(this.url.value, (s) => s.errorCorrection("Q"));
 *   });
 * }
 *
 * await run(Release);
 * ```
 *
 * The encoder covers byte mode (any UTF-8 text), versions 1–40 and all four
 * error-correction levels, picks the smallest version that fits, boosts the
 * level when it is free, and selects the mask by the specification's penalty
 * score. `QrTasks.encode` returns the `QrCode` matrix for other renderers.
 *
 * @module
 */

export { QrCapacityError } from "./src/codewords.ts";
export { type QrPrintOptions, QrTasks, type QrTasksApi } from "./src/qr.ts";
export { MAX_QUIET_ZONE, QrSettings } from "./src/settings.ts";
export { type QrCode } from "./src/symbol.ts";
export { type ErrorCorrectionLevel } from "./src/tables.ts";
