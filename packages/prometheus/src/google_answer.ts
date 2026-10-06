// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The pieces every Google token flow shares: the step descriptor its errors
 * are named by, reading an OAuth access-token answer, and an optional field
 * of a credentials file.
 *
 * @module
 */

import { answerSeconds, answerString, type AuthStep } from "./auth_http.ts";
import { own } from "./shape.ts";
import type { Expiring } from "./token_cache.ts";

/** The step descriptor for a Google request, with the secrets it carries. */
export function googleStep(step: string, secrets: readonly string[]): AuthStep {
  return { provider: "google", step, secrets };
}

/**
 * An OAuth access-token answer (`access_token`, `expires_in`) as an
 * {@link Expiring} token. An answer without `expires_in` is used once and not
 * cached.
 */
export function googleAnswer(
  answer: Record<string, unknown>,
  step: AuthStep,
  now: number,
): Expiring<string> {
  const token = answerString(answer, "access_token", step);
  const lifetime = answerSeconds(answer, "expires_in", step) ?? 0;
  return { value: token, expiresAt: now + lifetime * 1000 };
}

/** An optional string field: absent, empty or not a string is `undefined`. */
export function optionalString(
  json: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = own(json, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}
