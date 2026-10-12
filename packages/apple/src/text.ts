// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Making tool-supplied text safe to put in an error message.
 *
 * A notarization log and a `find-identity` listing are written by a remote
 * service or by whoever made the certificate, and both end up in the messages
 * this package throws. Control characters in them — an ANSI escape that
 * rewrites the terminal, a newline that forges a log line — are collapsed to a
 * single space, as are the Unicode line separators and the bidirectional
 * controls that can make a terminal show text in a different order than it was written, and the result
 * is capped so a hostile log cannot flood the build output.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

/** The longest single value {@link printable} keeps, in characters. */
const MAX_VALUE_LENGTH = 500;

/**
 * Control characters, the Unicode line and paragraph separators, and the
 * bidirectional formatting characters (the Arabic letter mark included).
 */
const UNPRINTABLE =
  // deno-lint-ignore no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g;

/** `value` with every run of unprintable characters collapsed to one space. */
export function printable(value: string): string {
  const flat = value.replace(UNPRINTABLE, " ").trim();
  return flat.length > MAX_VALUE_LENGTH
    ? `${flat.slice(0, MAX_VALUE_LENGTH)}…`
    : flat;
}
