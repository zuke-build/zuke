// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Finding the secrets in what a credential-bearing command printed, so its
 * settings can register them with the run's redactor — the one implementation
 * behind `ToolSettings.markSecretsInOutput`.
 *
 * A command that prints a credential — an access token, a registry password,
 * a secret's value, role credentials — runs quietly, so nothing is streamed;
 * registering what it returned is what keeps the value masked when the build
 * goes on to print it, pass it to another command, or fail with it in an error.
 *
 * The rule is to err towards masking, without masking ordinary words. A
 * wrapper pins JSON output, but a caller's query can still reshape the answer
 * — rename a key, move the secret under another — so:
 *
 * - a string under one of the expected keys is registered whatever its length
 *   (once the caller has queried, only when it is eight or more characters
 *   long: the key no longer says what it holds);
 * - a credential-named field anywhere in the document is registered;
 * - when the caller set a query, or no expected key is present, every scalar
 *   leaf (string, number, boolean) of eight or more characters is registered;
 * - an answer that is itself one JSON string is the secret, and output that is
 *   not JSON at all is registered whole — unless it is empty;
 * - a blank value is never registered: it would mask every space in the log.
 *
 * Every secret found that way is then searched for the parts a build might
 * print on their own: the credential-named fields of a secret that is itself
 * JSON, the credential-named `name=value` pairs of a connection string or a
 * dotenv file, and the password of a `scheme://user:pass@host` URL. A value
 * that is *derived* — found by name, as a leaf, or as a part — must clear
 * {@link MIN_DERIVED_LENGTH}, so `true`, `12` or `Bearer` never masks the log.
 *
 * Internal: `ToolSettings` is the public surface. The walks are iterative and
 * the part search is depth-bounded, so neither a deeply nested document nor a
 * self-similar secret can overflow the stack or run away — `onOutput` must not
 * throw.
 *
 * @module
 */

import { isCredentialName } from "./credential_name.ts";
import { asObject } from "./json_shape.ts";
import { MIN_DERIVED_LENGTH } from "./redact.ts";
import { urlPasswords } from "./redact_url.ts";
import type { SecretOutputSettings } from "./secret_output_settings.ts";

/**
 * How many layers of parts are searched beneath a secret — JSON in a field, a
 * connection string in that, a URL in that. Bounds the work on a secret built
 * to nest without end (`pwd=pwd=pwd=…`) to a few linear passes.
 */
const MAX_PART_DEPTH = 4;

/** One scalar leaf of a JSON document, and the field it sits under. */
interface Leaf {
  /** The leaf as text: a string as is, a number or boolean stringified. */
  text: string;
  /** Whether the leaf is a JSON string rather than a number or boolean. */
  isString: boolean;
  /**
   * The nearest field name above the leaf — an array's elements sit under the
   * array's field — or `undefined` for a leaf with no field above it.
   */
  key: string | undefined;
}

/** `text` parsed as JSON, or `undefined` when it is not JSON. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Whether `value` is long enough to register when it is derived. */
function longEnough(value: string): boolean {
  return value.length >= MIN_DERIVED_LENGTH;
}

/** Every scalar leaf of `document`, walked without recursion. */
function leavesOf(document: unknown): Leaf[] {
  const leaves: Leaf[] = [];
  const pending: Array<{ value: unknown; key: string | undefined }> = [
    { value: document, key: undefined },
  ];
  for (let i = 0; i < pending.length; i++) {
    const { value, key } = pending[i];
    if (Array.isArray(value)) {
      for (const item of value) pending.push({ value: item, key });
      continue;
    }
    const record = asObject(value);
    if (record !== null) {
      for (const [field, child] of Object.entries(record)) {
        pending.push({ value: child, key: field });
      }
    } else if (typeof value === "string") {
      leaves.push({ text: value, isString: true, key });
    } else if (typeof value === "number" || typeof value === "boolean") {
      leaves.push({ text: String(value), isString: false, key });
    }
  }
  return leaves;
}

/** The leaves under a credential-named field, long enough to register. */
function credentialLeaves(leaves: Leaf[]): string[] {
  return leaves
    .filter((leaf) =>
      leaf.key !== undefined && isCredentialName(leaf.key) &&
      longEnough(leaf.text)
    )
    .map((leaf) => leaf.text);
}

/** The secrets in a parsed JSON `document` that is not a single string. */
function inDocument(
  document: unknown,
  settings: SecretOutputSettings,
): string[] {
  const leaves = leavesOf(document);
  const named = leaves
    .filter((leaf) =>
      leaf.isString && leaf.key !== undefined &&
      settings.keys_.includes(leaf.key)
    )
    .map((leaf) => leaf.text);
  const trusted = settings.queried_ ? named.filter(longEnough) : named;
  const derived = settings.queried_ || named.length === 0
    ? leaves.map((leaf) => leaf.text).filter(longEnough)
    : [];
  return [...trusted, ...credentialLeaves(leaves), ...derived];
}

/**
 * Strip one pair of matching quotes around `value`, as a dotenv or YAML file
 * writes a value with spaces in it.
 */
function unquoted(value: string): string {
  const quoted = /^(["'])(.*)\1$/s.exec(value);
  return quoted === null ? value : quoted[2];
}

/**
 * The credential-named values of `text` read as `name=value` (or `name:
 * value`) pairs, one per `;` or line: a connection string's `AccountKey=` or
 * `Password=`, a dotenv file's `DB_PASSWORD=`, a YAML `token:` line. A pair
 * is split at its first `=` or `:`, so `Server=tcp:host` is named `Server`.
 */
function pairValues(text: string): string[] {
  const values: string[] = [];
  for (const pair of text.split(/[;\r\n]+/)) {
    const separator = pair.search(/[=:]/);
    if (separator < 0) continue;
    if (!isCredentialName(pair.slice(0, separator))) continue;
    values.push(unquoted(pair.slice(separator + 1).trim()));
  }
  return values;
}

/**
 * The parts of `secret` a build might print on their own: the credential
 * fields of a secret that is itself JSON (or the string a JSON-encoded one
 * decodes to), the credential pairs of one that is not, and the password of
 * every URL in it. Each must clear {@link MIN_DERIVED_LENGTH}.
 */
function partsOf(secret: string): string[] {
  const document = parsed(secret);
  const fields = document === undefined
    ? pairValues(secret)
    : typeof document === "string"
    ? [document]
    : credentialLeaves(leavesOf(document));
  return [...fields, ...urlPasswords(secret)].filter(longEnough);
}

/**
 * `secrets` and, to {@link MAX_PART_DEPTH} layers, the parts of each — once
 * each, in the order found, without a blank one.
 */
function withParts(secrets: string[]): string[] {
  const found = new Set<string>();
  const pending = secrets.map((text) => ({ text, depth: 0 }));
  for (let i = 0; i < pending.length; i++) {
    const { text, depth } = pending[i];
    // A blank value is no secret, and registering one masks every space.
    if (text.trim() === "" || found.has(text)) continue;
    found.add(text);
    if (depth === MAX_PART_DEPTH) continue;
    for (const part of partsOf(text)) {
      pending.push({ text: part, depth: depth + 1 });
    }
  }
  return [...found];
}

/**
 * The secrets in `stdout`, a credential-bearing command's output described by
 * `settings`, by the rules in this module's documentation.
 */
export function secretsInOutput(
  stdout: string,
  settings: SecretOutputSettings,
): string[] {
  const text = stdout.trim();
  const document = parsed(text);
  if (document === undefined) return withParts([text]);
  if (typeof document === "string") return withParts([document]);
  return withParts(inDocument(document, settings));
}
