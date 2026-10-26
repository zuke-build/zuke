// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Signing in with a service-account key: its RS256 JWT assertion (core's
 * `signJwtRs256`) is exchanged at the key's `token_uri` for an access token
 * with the Android Publisher scope.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { assertSecureBackendUrl, signJwtRs256 } from "@zuke/core";
import { GooglePlayError } from "./errors.ts";
import type { GooglePlaySettings } from "./google_play_settings.ts";
import { stringAt } from "./json.ts";

/** Google's OAuth 2.0 token endpoint, when the key names none. */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** The scope every Google Play Developer API call needs. */
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/** How long the signed assertion is valid: Google's maximum. */
const ASSERTION_TTL_SECONDS = 3600;

/** The text of a thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * An access token for the service account whose key JSON is `json`.
 *
 * @throws {GooglePlayError} when the key is not a service-account key or
 *   Google refuses it; the message never quotes the key.
 */
export async function serviceAccountToken(
  json: string,
  settings: GooglePlaySettings,
  signal: AbortSignal,
): Promise<string> {
  let key: unknown;
  try {
    key = JSON.parse(json);
  } catch {
    throw new GooglePlayError(
      "Google Play: .serviceAccount() is not the JSON of a service-account key.",
    );
  }
  const email = stringAt(key, "client_email");
  const privateKey = stringAt(key, "private_key");
  if (email === undefined || privateKey === undefined) {
    throw new GooglePlayError(
      "Google Play: the service-account key has no client_email or " +
        "private_key; download the key as JSON from the Play Console.",
    );
  }
  const tokenUri = stringAt(key, "token_uri") ?? GOOGLE_TOKEN_URL;
  assertSecureBackendUrl(
    tokenUri,
    "service-account token_uri",
    settings.readEnv_,
  );
  const iat = Math.floor(settings.now_() / 1000);
  let assertion: string;
  try {
    assertion = await signJwtRs256(
      privateKey,
      {
        iss: email,
        scope: SCOPE,
        aud: tokenUri,
        iat,
        exp: iat + ASSERTION_TTL_SECONDS,
      },
      stringAt(key, "private_key_id"),
    );
  } catch (error) {
    // Core's message names what is wrong with the key and never quotes it.
    throw new GooglePlayError(
      `Google Play: the service-account key's private_key is not an RSA key: ${
        messageOf(error)
      }`,
    );
  }
  const response = await settings.fetch_(tokenUri, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    redirect: "error",
    signal,
  });
  const body: unknown = await response.json().catch(() => undefined);
  const token = stringAt(body, "access_token");
  if (!response.ok || token === undefined) {
    const detail = stringAt(body, "error_description") ??
      stringAt(body, "error");
    throw new GooglePlayError(
      `Google Play: signing in as ${email} failed (HTTP ${response.status})` +
        (detail === undefined ? "." : `: ${detail}`),
      response.status,
    );
  }
  return token;
}
