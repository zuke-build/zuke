// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one guard every message this package builds from outside text goes
 * through: a SignPath answer, a status string, a runtime's error message.
 *
 * {@link scrub} masks the credentials the call carries (the redactor holds the
 * API token and, for a GitHub-origin submission, the GitHub token), strips any
 * URL's userinfo and credential-bearing parameters, collapses control
 * characters, Unicode line separators and bidirectional controls to a space —
 * so a hostile answer can neither rewrite the terminal nor forge a log line —
 * and caps the result. Masking runs before capping: capping first could cut a
 * secret in half and leave a prefix nothing matches.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { type Redactor, redactUrls } from "@zuke/core";

/** The longest piece of outside text a message carries, in characters. */
const MAX_DETAIL = 500;

/**
 * Control characters, the Unicode line and paragraph separators, and the
 * bidirectional formatting characters (the Arabic letter mark included).
 */
const UNPRINTABLE =
  // deno-lint-ignore no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g;

/** `text`, safe to put in an error message or a log line. */
export function scrub(redactor: Redactor, text: string): string {
  const clean = redactUrls(redactor.redact(text)).replace(UNPRINTABLE, " ")
    .replace(/\s+/g, " ").trim();
  return clean.length > MAX_DETAIL ? `${clean.slice(0, MAX_DETAIL)}…` : clean;
}
