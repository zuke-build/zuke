// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Finding the secrets in what a credential-bearing `az` command printed, so
 * its settings can register them with the run's redactor.
 *
 * Internal to the package. The commands that print a credential — an access
 * token, a registry token, a Key Vault secret's value — run quietly, so
 * nothing is streamed; registering what they returned is what keeps the value
 * masked when the build goes on to print it, pass it to another command, or
 * fail with it in an error.
 *
 * The rule is to err towards masking, without masking ordinary words. The
 * commands pin `--output json`, but a caller's `--query` can still reshape
 * the answer — rename a key, move the secret under another — so:
 *
 * - the value under each expected key is registered, whatever its length;
 * - a credential-named field anywhere in the document is registered;
 * - when the caller set a query, or none of the keys is present, every scalar
 *   leaf of eight or more characters is registered too;
 * - an answer that is itself one JSON string (a reader's pinned projection)
 *   is the secret, and output that is not JSON at all is registered whole.
 *
 * @module
 */

import { isRecord } from "./shape.ts";

/**
 * The shortest value worth registering when it is *derived* — found by name
 * or as a leaf rather than being the secret itself. A short one would mask
 * ordinary text (`true`, `12`, `Bearer`) wherever it appeared; eight
 * characters is the threshold core's redactor uses for the lines of a
 * multi-line secret, for the same reason.
 */
const MIN_DERIVED_LENGTH = 8;

/**
 * A field name that marks its value as a credential, matched on the name's
 * last segments once camelCase is split: `password`, `db_pwd`,
 * `clientSecret`, `apiKey`, `accountKey`, `SharedAccessKey`, `sas`,
 * `connectionString`, `privateKeyPem`, `credentials` — but not `keyId`,
 * `tokenType` or `hostname`.
 */
const CREDENTIAL_NAME =
  /(^|[_-])(pass(word)?|passwd|pwd|secret|token|key|sas|pem|connection_?string|credentials?)$/i;

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

/** Whether `value` is long enough to register when it is derived. */
function longEnough(value: string): boolean {
  return value.length >= MIN_DERIVED_LENGTH;
}

/** The credential-named string fields, at any depth, of `value`. */
function credentialFields(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(credentialFields);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "string"
      ? CREDENTIAL_NAME.test(segmented(key)) && longEnough(child) ? [child] : []
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

/** The secrets in `stdout`, by the rules in this module's documentation. */
function secretsIn(
  stdout: string,
  keys: readonly string[],
  queried: boolean,
): string[] {
  const text = stdout.trim();
  const document = parsed(text);
  if (document === undefined) return text === "" ? [] : [text];
  if (typeof document === "string") return [document, ...fieldsOf(document)];
  const named = underKeys(document, keys);
  const derived = queried || named.length === 0
    ? leaves(document).filter(longEnough)
    : [];
  const found = [...named, ...credentialFields(document), ...derived];
  return [...new Set([...found, ...found.flatMap(fieldsOf)])];
}

/**
 * Register the secrets in `stdout` through `mark` — the settings'
 * `markSecret`. `keys` are the fields the command returns its secret under;
 * `queried` says whether the caller set a `--query` that may have moved it.
 */
export function registerSecrets(
  stdout: string,
  keys: readonly string[],
  queried: boolean,
  mark: (secret: string) => void,
): void {
  for (const secret of secretsIn(stdout, keys, queried)) mark(secret);
}
