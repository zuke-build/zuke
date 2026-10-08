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
 * — rename a key, move the secret under another — so a value is registered by
 * what makes it a secret, and each kind has its own threshold:
 *
 * - **The answer** — output that is not JSON, a number or boolean answer as
 *   written, or an answer that is one JSON string; and, once the caller
 *   queried or no expected key is present, a non-empty JSON document printed
 *   whole, its only string, or the lone scalar of a one-element list — is
 *   registered **whatever its length**. A short queried PIN must be masked, so
 *   a queried `Bearer` is masked too.
 * - **A keyed value** — under one of the expected keys, under a credential
 *   name anywhere in the document (`password`, `clientSecret`, `accountKey`,
 *   `connectionString`, …), any leaf of a document with **none** of the
 *   expected keys, or a credential pair, URL password or decoded base64
 *   credential found inside a secret — is registered from
 *   {@link MIN_KEYED_LENGTH} characters, unless it is one of the
 *   {@link ENUM_WORDS} (`on`, `true`, `enabled`), and is searched for parts.
 * - **A derived value** — any other leaf of a queried document that still
 *   carries an expected key, or any leaf of a secret that is itself JSON —
 *   must clear {@link MIN_DERIVED_LENGTH}; in a queried document it is also
 *   skipped under ordinary vocabulary (`region`, `type`, an `id`, a date, an
 *   `error`; see `./credential_name.ts`). At most {@link DERIVED_BUDGET} are
 *   registered per output; keyed values never count against it.
 *
 * When **none** of the expected keys is present, the secret has moved: a
 * query renamed it (`{id: SecretString}`, `[Name, SecretString]`), or the
 * output is not the shape the wrapper knows. Either way no field name says
 * anything about what its value is — `id` or `type` may hold the secret — so
 * every leaf is a keyed value, with no vocabulary filter, and a short PIN or a
 * renamed JSON secret or connection string is still found. Output never queried
 * with none of the keys is read the same way, since the wrapper's knowledge of
 * its shape is just as void. Only when an expected key is still present does
 * the key say where the secret is, and the other leaves of a queried document
 * fall to the derived threshold.
 *
 * A number is registered as the output spells it — `1e10`, or a twenty-digit
 * id a double would round. A blank value is never registered, and every value
 * is registered trimmed too, so a secret stored with a trailing newline is
 * masked in either form. Every value a JSON encoder would escape is also
 * registered as the raw output spells it: JSON-escaped, with `\/`, and with
 * Go's `<`-style HTML escaping.
 *
 * Every secret found is then searched for the parts a build might print on
 * their own, to {@link MAX_PART_DEPTH} layers: the leaves of a secret that is
 * itself JSON (whole, or a line or `{…}` span of it), the credential pairs of a
 * connection string, query string, dotenv, YAML or XML file, the password of a
 * `scheme://user:pass@host` URL, and the decoded text of a base64 credential
 * (a Docker `auth`'s `user:pass`).
 *
 * Internal: `ToolSettings` is the public surface. The walks are iterative and
 * bounded, so neither a deeply nested document nor a self-similar secret can
 * overflow the stack or run away — `onOutput` must not throw.
 *
 * @module
 */

import {
  isCredentialName,
  isErrorName,
  isNonSecretName,
} from "./credential_name.ts";
import { asObject } from "./json_shape.ts";
import { MIN_DERIVED_LENGTH } from "./redact.ts";
import { urlPasswords } from "./redact_url.ts";
import type { SecretOutputSettings } from "./secret_output_settings.ts";

/** The shortest keyed value registered: long enough to skip `on` and `1`. */
const MIN_KEYED_LENGTH = 3;

/**
 * Words a keyed or derived value takes when it is a setting, not a secret —
 * registered, they would mask every `true` in the log.
 */
const ENUM_WORDS = new Set([
  "true",
  "false",
  "null",
  "none",
  "enabled",
  "disabled",
  "default",
]);

/**
 * The most derived values registered for one output. A listing of thousands
 * of leaves is not thousands of secrets, and each one registered costs every
 * line the build prints afterwards a pass.
 */
const DERIVED_BUDGET = 2_000;

/**
 * How many layers of parts are searched beneath a secret — JSON in a field, a
 * connection string in that, a URL in that. Bounds the work on a secret built
 * to nest without end (`pwd=pwd=pwd=…`) to a few linear passes.
 */
const MAX_PART_DEPTH = 4;

/** Why a value is a secret, which sets the threshold it must clear. */
type Kind = "answer" | "keyed" | "derived";

/** A JSON number, as the output spells it. */
class NumberText {
  /** The number's source text, e.g. `1e10`. */
  readonly source: string;

  /** Wrap `source`, a number's spelling in the JSON text. */
  constructor(source: string) {
    this.source = source;
  }
}

/**
 * The reviver that keeps each number's source spelling. The reviver type
 * declares `context` optional, as engines without JSON source text access
 * pass none; the parsed value's own spelling is then the best left.
 */
function keepNumberSource(
  _key: string,
  value: unknown,
  context?: { source?: unknown },
): unknown {
  if (typeof value !== "number") return value;
  const source = context?.source;
  return new NumberText(typeof source === "string" ? source : String(value));
}

/**
 * `text` parsed as JSON with numbers kept as written, or `undefined` when it is
 * not JSON. A reviver walks the document recursively, so one nested too deep
 * for it is parsed again without: its numbers lose their spelling, but its
 * strings are still found.
 */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text, keepNumberSource);
  } catch (error) {
    if (!(error instanceof RangeError)) return undefined;
  }
  return JSON.parse(text);
}

/** Whether `value` is a JSON object or array. */
function isContainer(value: unknown): value is object {
  return Array.isArray(value) || asObject(value) !== null &&
      !(value instanceof NumberText);
}

/** A string or number leaf's text, or `undefined` for anything else. */
function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return value instanceof NumberText ? value.source : undefined;
}

/** One string or number leaf of a JSON document, and the field above it. */
interface Leaf {
  /** The leaf as the output spells it. */
  text: string;
  /** Whether the leaf is a JSON string rather than a number. */
  isString: boolean;
  /**
   * The nearest field name above the leaf — an array's elements sit under the
   * array's field — or `undefined` for a leaf with no field above it.
   */
  key: string | undefined;
  /** Whether the leaf sits anywhere under an `error` or `errors` field. */
  inError: boolean;
}

/** Every string and number leaf of `document`, walked without recursion. */
function leavesOf(document: unknown): Leaf[] {
  const leaves: Leaf[] = [];
  const pending: Array<
    { value: unknown; key: string | undefined; inError: boolean }
  > = [{ value: document, key: undefined, inError: false }];
  for (let i = 0; i < pending.length; i++) {
    const { value, key, inError } = pending[i];
    const text = scalarText(value);
    if (text !== undefined) {
      leaves.push({ text, isString: typeof value === "string", key, inError });
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push({ value: item, key, inError });
    } else {
      const record = asObject(value);
      for (const [field, child] of Object.entries(record ?? {})) {
        pending.push({
          value: child,
          key: field,
          inError: inError || isErrorName(field),
        });
      }
    }
  }
  return leaves;
}

/** Whether `trimmed`, a value of `kind`, clears that kind's threshold. */
function qualifies(kind: Kind, trimmed: string): boolean {
  if (trimmed === "") return false;
  if (kind === "answer") return true;
  if (ENUM_WORDS.has(trimmed.toLowerCase())) return false;
  return trimmed.length >=
    (kind === "keyed" ? MIN_KEYED_LENGTH : MIN_DERIVED_LENGTH);
}

/**
 * The spellings of `value` the raw output may carry instead: JSON-escaped,
 * with `/` escaped too, and with Go's HTML-safe `<`/`>`/`&`
 * (and line-separator) escapes.
 */
function spellings(value: string): string[] {
  const escaped = JSON.stringify(value).slice(1, -1);
  const html = escaped.replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return [value, escaped, html].flatMap((s) => [s, s.replaceAll("/", "\\/")]);
}

/**
 * Split `line` on `;`, `&` and `?` — a connection string's, a query string's
 * separators — except inside quotes, so `Password="a;b"` stays one pair.
 */
function splitPairs(line: string): string[] {
  const parts: string[] = [];
  let quote = "";
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== "") {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ";" || c === "&" || c === "?") {
      parts.push(line.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(line.slice(start));
  return parts;
}

/** `text` without one pair of matching quotes around it, JSON-decoded. */
function unquoted(text: string): string {
  if (/^".*"$/s.test(text)) {
    const decoded = parsed(text);
    if (typeof decoded === "string") return decoded;
  }
  const single = /^'(.*)'$/s.exec(text);
  return single === null ? text : single[1];
}

/**
 * `value` without the `,`, `}` and `]` a JSON line ends with, trimmed — by a
 * loop from the end, where an anchored pattern would rescan every run of them.
 */
function withoutClosers(value: string): string {
  let end = value.length;
  while (end > 0 && ",}]".includes(value[end - 1])) end--;
  return value.slice(0, end).trim();
}

/**
 * The credential-named values of `line` read as pairs: `name=value` or
 * `name: value` per `;`/`&`/`?`-separated part, split at its first `=` or `:`
 * (so `Server=tcp:host` is named `Server`), and XML attributes `name="value"`
 * anywhere on it. Names and values are unquoted, and a value loses the
 * trailing `,`, `}` or `]` of the JSON line it was cut from.
 */
function pairValues(line: string): string[] {
  const values: string[] = [];
  // The lookbehind starts a name only where one begins, so a long word with
  // no `=` after it is scanned once, not once from every character in it.
  const attributes = /(?<![\w.:-])([\w.:-]+)\s*=\s*(["'])(.*?)\2/g;
  for (const attribute of line.matchAll(attributes)) {
    if (isCredentialName(attribute[1])) values.push(attribute[3]);
  }
  for (const pair of splitPairs(line)) {
    const separator = pair.search(/[=:]/);
    if (separator < 0) continue;
    if (!isCredentialName(unquoted(pair.slice(0, separator).trim()))) continue;
    values.push(unquoted(withoutClosers(pair.slice(separator + 1).trim())));
  }
  return values;
}

/**
 * The text a base64 credential decodes to, when it is base64 and decodes to
 * printable UTF-8 — a Docker `auth`'s `user:pass`, a kubeconfig's
 * `client-key-data` — or `undefined`.
 */
function decodedBase64(value: string): string | undefined {
  if (value.length < 8 || value.length % 4 !== 0) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return undefined;
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  // deno-lint-ignore no-control-regex
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
    ? undefined
    : text;
}

/** The secrets found in one output, and the work of searching their parts. */
class Findings {
  /** Every value registered, in the order found. */
  readonly #found = new Set<string>();
  /** Values whose parts are still to search. */
  readonly #pending: Array<{ text: string; kind: Kind; depth: number }> = [];
  /** How many more derived values may be registered. */
  #budget = DERIVED_BUDGET;

  /**
   * Register `value` as a secret of `kind`, and trimmed, when it clears the
   * kind's threshold; queue it to have its parts searched unless `whole` —
   * the output itself, whose document is searched directly.
   */
  add(value: string, kind: Kind, depth: number, whole = false): void {
    const trimmed = value.trim();
    if (!qualifies(kind, trimmed) || this.#found.has(trimmed)) return;
    if (kind === "derived") {
      if (this.#budget === 0) return;
      this.#budget--;
    }
    this.#found.add(value);
    this.#found.add(trimmed);
    if (!whole) this.#pending.push({ text: trimmed, kind, depth });
  }

  /** Search every queued value's parts, to {@link MAX_PART_DEPTH} layers. */
  searchParts(): void {
    for (let i = 0; i < this.#pending.length; i++) {
      const { text, kind, depth } = this.#pending[i];
      if (depth < MAX_PART_DEPTH) this.#partsOf(text, kind, depth + 1);
    }
  }

  /** Every value found, in each spelling the output may carry it in. */
  all(): string[] {
    return [...new Set([...this.#found].flatMap(spellings))];
  }

  /**
   * The parts of `secret`, at `depth`: the leaves of a secret that is itself
   * JSON (or the string a JSON-encoded one decodes to), the JSON lines and
   * credential pairs of one that is not, every URL password in it, and — for
   * a keyed value — the text it decodes to as base64.
   */
  #partsOf(secret: string, kind: Kind, depth: number): void {
    const document = parsed(secret);
    if (isContainer(document)) this.#documentParts(document, depth);
    else if (typeof document === "string") this.add(document, kind, depth);
    else if (document === undefined) this.#textParts(secret, depth);
    for (const password of urlPasswords(secret)) {
      this.add(password, "keyed", depth);
    }
    if (kind !== "keyed") return;
    const decoded = decodedBase64(secret);
    if (decoded === undefined) return;
    this.add(decoded, "keyed", depth);
    const colon = decoded.indexOf(":");
    if (colon >= 0 && !decoded.includes("\n")) {
      this.add(decoded.slice(colon + 1), "keyed", depth);
    }
  }

  /**
   * The parts of a secret that is a JSON `document`: every long leaf, every
   * credential-named one, and the URL passwords in its decoded strings.
   */
  #documentParts(document: object, depth: number): void {
    for (const leaf of leavesOf(document)) {
      if (leaf.key !== undefined && isCredentialName(leaf.key)) {
        this.add(leaf.text, "keyed", depth);
      }
      this.add(leaf.text, "derived", depth);
      if (!leaf.isString) continue;
      for (const password of urlPasswords(leaf.text)) {
        this.add(password, "keyed", depth);
      }
    }
  }

  /**
   * The parts of a secret that is not JSON: each line or `{…}` span of it
   * that is, and every credential pair in it.
   */
  #textParts(secret: string, depth: number): void {
    const open = secret.indexOf("{");
    const close = secret.lastIndexOf("}");
    const spans = open >= 0 && close > open
      ? [secret.slice(open, close + 1)]
      : [];
    const lines = secret.split(/\r?\n/);
    for (const span of [...spans, ...lines.map((line) => line.trim())]) {
      if (!span.startsWith("{") && !span.startsWith("[")) continue;
      const document = parsed(span);
      if (isContainer(document)) this.#documentParts(document, depth);
    }
    for (const line of lines) {
      for (const value of pairValues(line)) this.add(value, "keyed", depth);
    }
  }
}

/**
 * Register the secrets in `document`, the JSON object or list the whole
 * output `text` parsed to, by the rules in this module's documentation.
 */
function inDocument(
  document: object,
  text: string,
  settings: SecretOutputSettings,
  findings: Findings,
): void {
  const leaves = leavesOf(document);
  const keyed = leaves.filter((leaf) =>
    leaf.key !== undefined && settings.keys_.includes(leaf.key)
  );
  // Keyed first: a value found under a name is searched as one (a base64
  // credential is decoded), whatever else also makes it a secret.
  for (const leaf of keyed) findings.add(leaf.text, "keyed", 0);
  for (const leaf of leaves) {
    if (leaf.key !== undefined && isCredentialName(leaf.key)) {
      findings.add(leaf.text, "keyed", 0);
    }
    if (leaf.isString) {
      for (const password of urlPasswords(leaf.text)) {
        findings.add(password, "keyed", 0);
      }
    }
  }
  // No expected key at all: the secret moved — a query renamed it, or the
  // output is not the shape the wrapper knows — so any leaf may be it.
  const moved = keyed.length === 0;
  if (moved) { for (const leaf of leaves) findings.add(leaf.text, "keyed", 0); }
  if (settings.queried_ || moved) {
    reshapedAnswer(document, text, leaves, findings);
  }
  if (settings.queried_ && !moved) derivedLeaves(leaves, findings);
}

/**
 * Register what an output the caller reshaped — or one with none of the
 * expected keys — holds as its answer: the output whole, and so its only
 * string or the lone element of a one-element list.
 */
function reshapedAnswer(
  document: object,
  text: string,
  leaves: Leaf[],
  findings: Findings,
): void {
  // An empty `{}` or `[]` holds nothing, and registered would mask every one.
  if (leaves.length > 0) findings.add(text, "answer", 0, true);
  const strings = leaves.filter((leaf) => leaf.isString);
  if (strings.length === 1) findings.add(strings[0].text, "answer", 0);
  if (Array.isArray(document) && document.length === 1) {
    const only = scalarText(document[0]);
    if (only !== undefined) findings.add(only, "answer", 0);
  }
}

/**
 * Register the leaves of a queried output that still carries an expected key,
 * as derived values: long enough, and not under ordinary vocabulary.
 */
function derivedLeaves(leaves: Leaf[], findings: Findings): void {
  for (const leaf of leaves) {
    const plain = leaf.inError ||
      (leaf.key !== undefined && isNonSecretName(leaf.key));
    if (!plain) findings.add(leaf.text, "derived", 0);
  }
}

/**
 * The secrets in `stdout`, a credential-bearing command's output described by
 * `settings`, by the rules in this module's documentation.
 */
export function secretsInOutput(
  stdout: string,
  settings: SecretOutputSettings,
): string[] {
  const findings = new Findings();
  const text = stdout.trim();
  const document = parsed(text);
  if (typeof document === "string") findings.add(document, "answer", 0);
  else if (isContainer(document)) {
    inDocument(document, text, settings, findings);
  } else if (document !== null) findings.add(text, "answer", 0);
  findings.searchParts();
  return findings.all();
}
