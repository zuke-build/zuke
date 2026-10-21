// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The JSON Web Token every App Store Connect API request carries: ES256,
 * signed with the API key's P-256 private key through WebCrypto, valid for
 * the 20 minutes the API allows at most.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { decodeBase64 } from "./base64.ts";

/** How long a token is valid: the API refuses more than 20 minutes. */
const LIFETIME_SECONDS = 20 * 60;

/** `bytes` as unpadded base64url. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

/** A JSON value as base64url. */
function encodeJson(value: Record<string, string | number>): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * The PKCS #8 DER inside a PEM private key, or `undefined` when the text is
 * not one.
 */
function pemBody(pem: string): Uint8Array<ArrayBuffer> | undefined {
  const match = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/
    .exec(pem);
  return match === null ? undefined : decodeBase64(match[1]);
}

/** What signing a token needs. */
export interface TokenRequest {
  /** The API key's issuer id. */
  issuerId: string;
  /** The API key's id. */
  keyId: string;
  /** The private key, PEM. */
  privateKey: string;
  /** Now, in epoch ms. */
  now: number;
}

/**
 * Sign an App Store Connect API token.
 *
 * @throws {Error} when the private key is not a PKCS #8 P-256 key; the
 *   message never quotes the key.
 */
export async function signToken(request: TokenRequest): Promise<string> {
  const unusable = new Error(
    "App Store Connect: the private key is not the PEM of an " +
      "AuthKey_<keyId>.p8 file (a PKCS #8 P-256 key).",
  );
  const der = pemBody(request.privateKey);
  if (der === undefined) throw unusable;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  } catch {
    throw unusable;
  }
  const iat = Math.floor(request.now / 1000);
  const signingInput = `${
    encodeJson({ alg: "ES256", kid: request.keyId, typ: "JWT" })
  }.${
    encodeJson({
      iss: request.issuerId,
      iat,
      exp: iat + LIFETIME_SECONDS,
      aud: "appstoreconnect-v1",
    })
  }`;
  // WebCrypto's ECDSA signature is the raw r‖s pair JWS's ES256 expects.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
