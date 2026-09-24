// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/qr` — render a QR code in the terminal from a Zuke build, with no
 * runtime dependency and no ambient `qrencode`. A build that wants to hand a
 * URL to the people in the room prints it as a scannable code:
 *
 * ```ts
 * import { Build, parameter, run, target } from "@zuke/core";
 * import { QrTasks } from "@zuke/qr";
 *
 * class Demo extends Build {
 *   url = parameter("the page to point the room at").required();
 *   qr = target().executes(() => {
 *     QrTasks.print(this.url.value, (s) => s.errorCorrection("Q"));
 *   });
 * }
 *
 * await run(Demo);
 * ```
 *
 * The encoder covers byte mode (any UTF-8 text), versions 1–40 and all four
 * error-correction levels, picks the smallest version that fits, boosts the
 * level when it is free, and selects the mask by the specification's penalty
 * score. `QrTasks.encode` returns the raw module matrix for other renderers.
 *
 * @module
 */

export { QrCapacityError } from "./src/codewords.ts";
export { type QrPrintOptions, QrTasks, type QrTasksApi } from "./src/qr.ts";
export { QrSettings } from "./src/settings.ts";
export { type QrCode } from "./src/symbol.ts";
export { type ErrorCorrectionLevel } from "./src/tables.ts";
