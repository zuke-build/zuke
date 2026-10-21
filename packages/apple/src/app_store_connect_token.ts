// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The JSON Web Token every App Store Connect API request carries: ES256,
 * signed with the API key's P-256 private key by core's `signJwtEs256`, valid
 * for the 20 minutes the API allows at most.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { signJwtEs256 } from "@zuke/core";
import { messageOf } from "./text.ts";

/** How long a token is valid: the API refuses more than 20 minutes. */
const LIFETIME_SECONDS = 20 * 60;

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
  const iat = Math.floor(request.now / 1000);
  try {
    return await signJwtEs256(
      request.privateKey,
      {
        iss: request.issuerId,
        iat,
        exp: iat + LIFETIME_SECONDS,
        aud: "appstoreconnect-v1",
      },
      request.keyId,
    );
  } catch (error) {
    // Core's message names what is wrong with the key and never quotes it,
    // so it is kept in the message: empty, not base64, or not P-256.
    throw new Error(
      "App Store Connect: the private key is not the PEM of an " +
        `AuthKey_<keyId>.p8 file (a PKCS #8 P-256 key): ${messageOf(error)}`,
      { cause: error },
    );
  }
}
