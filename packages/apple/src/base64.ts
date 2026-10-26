// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one base64 decoder the package uses — for a `.p12` or a provisioning
 * profile from a CI secret, a plist's `<data>`, a PEM key's body.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

/**
 * `text` decoded from base64, ignoring whitespace (so a wrapped secret
 * decodes), or `undefined` when it is not base64. Never throws, so a caller
 * can raise its own error without echoing the text.
 */
export function decodeBase64(
  text: string,
): Uint8Array<ArrayBuffer> | undefined {
  const compact = text.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return undefined;
  try {
    return Uint8Array.from(atob(compact), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}
