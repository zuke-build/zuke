// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The URL guard for every URL a rendered package or a publish carries.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

/** Printable ASCII, no space: what a URL written into a package may hold. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/**
 * Refuse anything but a well-formed `https` URL of printable ASCII.
 *
 * Choco downloads and runs what a package's URL serves, so a plaintext URL is
 * an archive anyone on the path can replace — the checksum catches that, but
 * only after the download, and a package that asks for it is wrong either
 * way. Whitespace, control and non-ASCII characters are refused too: the URL
 * parser would quietly strip or re-encode some of them, so the URL that was
 * checked would not be the one written into the package. And a URL carrying a
 * user name or password is refused, since a published package would publish
 * it.
 *
 * The value itself is never echoed: a URL can carry a credential, in its
 * userinfo or its query, and an error message is a log line.
 *
 * @throws {Error} naming `field` and what is wrong.
 */
export function assertHttpsUrl(value: string, field: string): void {
  let parsed: URL | undefined;
  try {
    parsed = new URL(value);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined || !PRINTABLE_ASCII.test(value)) {
    throw new Error(
      `${field} must be a well-formed https:// URL of printable ASCII, with ` +
        `no whitespace or control characters.`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `${field} must be an https:// URL, not ${parsed.protocol}//.`,
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(
      `${field} must not carry a user name or password: a package is ` +
        `published, so anything in its URL is published with it.`,
    );
  }
}
