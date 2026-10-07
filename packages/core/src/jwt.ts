// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one RS256 JSON Web Token signer: a PEM RSA private key (PKCS#1 or
 * PKCS#8) and a claims object in, a compact `header.claims.signature` JWT out,
 * signed with WebCrypto.
 *
 * Exported because wrapper packages sign one and a wrapper may depend on core
 * alone: a GitHub App JWT exchanged for an installation token, a Google
 * service-account assertion exchanged for an access token. Two copies of the
 * PEM parsing and the base64url framing would drift apart; one does not.
 *
 * @module
 */

import { messageOf } from "./internal.ts";

/** Base64url without padding, as JWT requires (RFC 7515 §2). */
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

/** The DER length header for a payload of `length` bytes (short or long form). */
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) {
    bytes.unshift(rest % 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

/** The `AlgorithmIdentifier` for `rsaEncryption`, with its NULL parameters. */
const RSA_ALGORITHM_ID = [
  0x30,
  0x0d,
  0x06,
  0x09,
  0x2a,
  0x86,
  0x48,
  0x86,
  0xf7,
  0x0d,
  0x01,
  0x01,
  0x01,
  0x05,
  0x00,
];

/**
 * Wrap a PKCS#1 `RSAPrivateKey` in the PKCS#8 `PrivateKeyInfo` envelope
 * WebCrypto requires. GitHub hands out app keys in PKCS#1
 * (`BEGIN RSA PRIVATE KEY`), which `crypto.subtle.importKey` cannot read; the
 * envelope is a fixed prefix around the same key material.
 */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const key = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [0x02, 0x01, 0x00, ...RSA_ALGORITHM_ID, ...key];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

/** The DER bytes of a PEM block, whatever its label. */
function pemBody(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem
    .replace(/-----(BEGIN|END)[^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (base64 === "") {
    throw new Error(
      "the private key is empty — pass the PEM contents, not a path.",
    );
  }
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    // A body that is not base64 at all — a PEM mangled by copy-paste, or a
    // secret that was truncated. Naming it beats surfacing a bare DOMException.
    throw new Error(
      "the private key is not valid base64 — check the PEM was copied " +
        "whole, including both delimiter lines.",
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Import a PEM RSA key (PKCS#1 or PKCS#8) as an RS256 signing key. */
async function importSigningKey(pem: string): Promise<CryptoKey> {
  const der = pemBody(pem);
  const pkcs8 = /BEGIN RSA PRIVATE KEY/.test(pem) ? pkcs1ToPkcs8(der) : der;
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    // A malformed key is the most common misconfiguration (a truncated secret,
    // a path instead of contents), so name it rather than surface a DataError.
    // WebCrypto's own message never quotes the key material.
    throw new Error(
      `the private key could not be read as RSA PEM: ${messageOf(error)}`,
    );
  }
}

/**
 * Sign `claims` as a compact RS256 JWT with a PEM RSA private key —
 * `BEGIN RSA PRIVATE KEY` (PKCS#1) or `BEGIN PRIVATE KEY` (PKCS#8).
 *
 * The header is `{"alg":"RS256","typ":"JWT"}`, plus `"kid"` when `keyId` is
 * given (a Google service-account key's `private_key_id`). The claims are
 * serialised as given: the caller sets `iat`, `exp` and the rest.
 *
 * ```ts
 * const jwt = await signJwtRs256(pem, { iss: "1234", iat, exp: iat + 540 });
 * ```
 *
 * @throws {Error} naming the problem — an empty key, a body that is not
 *   base64, or one that is not an RSA key — and never quoting the key.
 */
export async function signJwtRs256(
  privateKeyPem: string,
  claims: Readonly<Record<string, unknown>>,
  keyId?: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const header = base64Url(
    encoder.encode(
      JSON.stringify(
        keyId === undefined
          ? { alg: "RS256", typ: "JWT" }
          : { alg: "RS256", typ: "JWT", kid: keyId },
      ),
    ),
  );
  const body = base64Url(encoder.encode(JSON.stringify(claims)));
  const key = await importSigningKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(`${header}.${body}`),
  );
  return `${header}.${body}.${base64Url(new Uint8Array(signature))}`;
}
