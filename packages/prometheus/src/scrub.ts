// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The two guards both of this package's HTTP paths — the Prometheus
 * transport and the credential sources' token requests — apply to what comes
 * back: {@link scrub}, which turns server or runtime text into a message that
 * carries no secret, and {@link refusedRedirect}, which spots a redirect that
 * must not be followed. One copy each, so the two paths cannot drift apart.
 *
 * @module
 */

import { type Redactor, redactUrls } from "@zuke/core";

/**
 * `text` with every secret `redactor` knows masked and every URL's
 * credentials stripped, whitespace collapsed, then capped at `max`
 * characters. Scrubbed first and capped second: capping first could cut a
 * secret in half and leave a prefix no pattern matches.
 */
export function scrub(redactor: Redactor, text: string, max: number): string {
  const clean = redactUrls(redactor.redact(text)).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * Whether `response` is a redirect — a 3xx, or the opaque answer a
 * `redirect: "manual"` fetch gives in a browser-like runtime. A redirect is
 * never followed: it could lead to a plaintext URL the `https:` rule never
 * saw, with the credential attached. Its body is released when it is one.
 */
export async function refusedRedirect(response: Response): Promise<boolean> {
  if (
    response.type !== "opaqueredirect" &&
    (response.status < 300 || response.status >= 400)
  ) {
    return false;
  }
  await response.body?.cancel();
  return true;
}
