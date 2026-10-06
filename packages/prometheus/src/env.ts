// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link envValue}: the one reading of an environment variable the credential
 * sources use, so they agree that an empty variable is an unset one — a CI
 * system that exports `AWS_PROFILE=` means "no profile", not a profile named
 * the empty string.
 *
 * @module
 */

/** `name`'s value from `readEnv`, `undefined` when unset or empty. */
export function envValue(
  readEnv: (name: string) => string | undefined,
  name: string,
): string | undefined {
  const value = readEnv(name);
  return value === "" ? undefined : value;
}
