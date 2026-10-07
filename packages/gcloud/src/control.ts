// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one test for a control character. Internal to the package: a filter
 * string and a bearer token both refuse one, and share this so the two never
 * disagree about which characters count.
 *
 * @module
 */

/** Whether `value` holds a C0 control character (a line break among them) or DEL. */
export function hasControl(value: string): boolean {
  // deno-lint-ignore no-control-regex
  return /[\u0000-\u001f\u007f]/.test(value);
}
