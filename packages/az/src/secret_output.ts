// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Finding the secrets in what a credential-bearing command printed, so its
 * settings can register them with the run's redactor.
 *
 * Internal to the package. The commands that print a secret — a secret's
 * value, a decrypted parameter, a registry password, role credentials,
 * a credential setting — run quietly, so nothing is streamed; registering
 * what they returned is what keeps the value masked when the build goes on to
 * print it, pass it to another command, or fail with it in an error.
 *
 * The rule is to err towards masking. The commands pin `--output json`, but a
 * caller's `--query` can still reshape the answer, so a document that does
 * not carry the expected keys has every scalar in it registered instead, and
 * output that is not JSON at all is registered whole.
 *
 * @module
 */

import { isRecord } from "./shape.ts";

/**
 * The shortest value worth registering when it is *derived* — found by name
 * inside a secret rather than being the secret. A short one would mask
 * ordinary text wherever it appeared; eight characters is the threshold core's
 * redactor uses for the lines of a multi-line secret, for the same reason.
 */
const MIN_DERIVED_LENGTH = 8;

/**
 * A field name that marks its value as a credential, matched on the name's
 * last segment once camelCase is split: `password`, `db_password`,
 * `clientSecret`, `apiKey`, `private-key`, `credentials` — but not `keyId`
 * or `tokenType`.
 */
const CREDENTIAL_NAME =
  /(^|[_-])(pass(word)?|passwd|secret|token|api_?key|private_?key|credentials?)$/i;

/** `name` with its camelCase boundaries turned into `_`, lowercased. */
function segmented(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Every scalar leaf of `value`, stringified: strings, numbers and booleans. */
function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (isRecord(value)) return Object.values(value).flatMap(leaves);
  return [];
}

/** The strings under one of `keys`, at any depth of `value`. */
function underKeys(value: unknown, keys: readonly string[]): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => underKeys(v, keys));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    keys.includes(key) && typeof child === "string"
      ? [child]
      : underKeys(child, keys)
  );
}

/**
 * The credential-named string fields, at any depth, of `value` — eight or
 * more characters long.
 */
function credentialFields(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(credentialFields);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "string"
      ? CREDENTIAL_NAME.test(segmented(key)) &&
          child.length >= MIN_DERIVED_LENGTH
        ? [child]
        : []
      : credentialFields(child)
  );
}

/** `text` parsed as JSON, or `undefined` when it is not JSON. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The credential-named fields of `secret`, when it is itself JSON. */
function fieldsOf(secret: string): string[] {
  return credentialFields(parsed(secret));
}

/**
 * The secrets in `stdout`.
 *
 * - A JSON document yields the string under each of `keys`, wherever it
 *   sits. When none of `keys` is present — the caller reshaped the answer
 *   with `--query` — every scalar in the document is registered instead.
 * - A secret found that way that is itself a JSON object (Secrets Manager's
 *   templates) also yields its credential-named fields, at any depth.
 * - Output that is not JSON, or JSON with nothing in it, is registered whole,
 *   trimmed: that is what a command such as `ecr get-login-password` prints.
 */
export function secretsIn(stdout: string, keys: readonly string[]): string[] {
  const text = stdout.trim();
  const document = parsed(text);
  if (document === null) return [];
  const named = underKeys(document, keys);
  const found = named.length > 0 ? named : leaves(document);
  if (found.length === 0) return text === "" ? [] : [text];
  return [...found, ...found.flatMap(fieldsOf)];
}
