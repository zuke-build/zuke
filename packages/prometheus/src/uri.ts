// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one percent-encoder for what this package puts in a URL: RFC 3986
 * strict, so every byte but the unreserved `A–Z a–z 0–9 - . _ ~` is escaped,
 * and a space is `%20`, never the form encoding's `+`.
 *
 * The transport encodes a `GET` call's parameters with it, and the AWS SigV4
 * signer encodes the canonical query with it. Using the same encoder for both
 * is what makes the URL that is sent byte-identical to the URL that was
 * signed: a `+` on the wire that one side reads as a space and the other as a
 * plus is a signature that fails for some queries and not others.
 *
 * @module
 */

/** `value` percent-encoded per RFC 3986 (unreserved characters kept). */
export function uriEncode(value: string): string {
  // A lone surrogate cannot be UTF-8 encoded; replace it as URLSearchParams
  // would rather than throw a URIError over a stray character in a query.
  return encodeURIComponent(value.toWellFormed()).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
