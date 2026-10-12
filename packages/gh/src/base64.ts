// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Base64 for request bodies — one copy for every endpoint in this package that
 * takes binary content inline (SARIF uploads, the contents API).
 *
 * @module
 */

/** Encode `bytes` as standard base64. */
export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
