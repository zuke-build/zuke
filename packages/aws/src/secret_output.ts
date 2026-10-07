// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Finding the secret in what a credential-bearing command printed, so its
 * settings can register it with the run's redactor.
 *
 * Internal to the package. The commands that print a secret — a secret's
 * value, a decrypted parameter, a registry password, role credentials — run
 * quietly, so nothing is streamed; registering what they returned is what
 * keeps the value masked when the build goes on to print it, pass it to
 * another command, or fail with it in an error.
 *
 * @module
 */

import { isRecord } from "./shape.ts";

/**
 * The field names, inside a JSON secret, whose values are credentials in
 * their own right: `password`, `client_secret`, `apiKey`, `token`, … Secrets
 * Manager's own templates keep a database password beside its username, host
 * and engine, so a build that parses the secret and prints only the password
 * must find that password already masked — while the engine name `postgres`
 * must not be masked everywhere it appears in the log.
 */
const CREDENTIAL_FIELD = /pass|secret|token|key|credential|auth/i;

/** Collect every string under one of `keys`, at any depth of `value`. */
function collect(value: unknown, keys: readonly string[], into: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, keys, into);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key) && typeof child === "string") into.push(child);
    else collect(child, keys, into);
  }
}

/**
 * The secrets in `stdout`. A JSON document yields the string under each of
 * `keys`, wherever it sits — a bare JSON string (what `--query X --output json`
 * prints) is itself the secret. Anything else is taken as the secret as a
 * whole, trimmed: that is what `--output text` with a pinned `--query`, and a
 * command such as `ecr get-login-password`, print.
 *
 * A secret that is itself a JSON object — the shape Secrets Manager's
 * templates use — also yields each of its fields whose name marks it as a
 * credential, so the password parsed out of it is masked on its own.
 */
export function secretsIn(stdout: string, keys: readonly string[]): string[] {
  const found = secretValuesIn(stdout, keys);
  return [...found, ...found.flatMap(credentialFieldsOf)];
}

/** The credential-named string fields of `secret`, when it is a JSON object. */
function credentialFieldsOf(secret: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  return Object.entries(parsed).flatMap(([key, value]) =>
    CREDENTIAL_FIELD.test(key) && typeof value === "string" ? [value] : []
  );
}

/** The secrets {@link secretsIn} reads before looking inside them. */
function secretValuesIn(stdout: string, keys: readonly string[]): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const text = stdout.trim();
    return text === "" ? [] : [text];
  }
  if (typeof parsed === "string") return [parsed];
  const found: string[] = [];
  collect(parsed, keys, found);
  return found;
}
