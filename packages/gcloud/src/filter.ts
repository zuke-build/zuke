// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Building Cloud Logging and Cloud Monitoring filters from typed parts.
 * Internal to the package.
 *
 * Both filters are free text in a query language, and a typed setter — a
 * resource label, a metric type — puts a value into that text. Interpolated
 * as it is, a value such as `api" OR resource.type="gce_instance` would end
 * its string literal and widen the filter: a canary would judge every
 * revision's errors instead of its own, and a log count would count the
 * whole project. So every value goes in as a string literal built here, and
 * every label key is checked to be a plain name.
 *
 * The two languages document their strings differently, and each is quoted
 * by what its own documentation says:
 *
 * - **Logging** ("Embedded quotation marks must be escaped with a
 *   backslash", and any escape sequence such as `\t` is honoured): `\` and
 *   `"` are escaped with a backslash.
 * - **Monitoring** documents double-quoted strings but no escape syntax at
 *   all, so a `"` or `\` in a value is refused rather than escaped on a
 *   guess. Write such a filter by hand with the raw `.filter(...)`.
 *
 * In both, a control character (a newline among them) is refused: neither
 * language promises what it does inside a string, and no real label value
 * carries one.
 *
 * @module
 */

import { hasControl } from "./control.ts";

/** A label key both languages accept unquoted after `labels.`. */
const KEY_SHAPE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Refuse a value with a control character, naming where it was going. */
function refuseControl(task: string, what: string, value: string): void {
  if (hasControl(value)) {
    throw new Error(
      `${task}: the ${what} ${
        JSON.stringify(value)
      } holds a control character, ` +
        "which has no defined meaning inside a filter string. Refused.",
    );
  }
}

/** `key`, refused unless it is a plain label name. */
export function labelKey(task: string, key: string): string {
  if (!KEY_SHAPE.test(key)) {
    throw new Error(
      `${task}: "${key}" is not a label key a filter can name unquoted — ` +
        "use letters, digits and underscores, starting with a letter or " +
        "underscore — or write the filter by hand with .filter(...).",
    );
  }
  return key;
}

/** `value` as a Cloud Logging string literal: quoted, `\` and `"` escaped. */
export function loggingString(
  task: string,
  what: string,
  value: string,
): string {
  refuseControl(task, what, value);
  return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/**
 * `value` as a Cloud Monitoring string literal: quoted, and refused when it
 * holds a `"` or a `\`, which the language gives no documented way to
 * escape.
 */
export function monitoringString(
  task: string,
  what: string,
  value: string,
): string {
  refuseControl(task, what, value);
  if (/[\\"]/.test(value)) {
    throw new Error(
      `${task}: the ${what} ${JSON.stringify(value)} holds a quotation mark ` +
        "or a backslash, and the Monitoring filter language documents no way " +
        "to escape one inside a string. Refused — write the filter by hand " +
        "with .filter(...) if you need it.",
    );
  }
  return `"${value}"`;
}

/**
 * `parts` joined with `AND`. A raw part is the caller's own filter text and
 * is wrapped in parentheses, so an `OR` inside it cannot reach past it to the
 * typed parts — and so a raw part that starts with the `-` negation never
 * starts the whole filter, where gcloud would read it as a flag. A blank raw
 * part is no filter at all, and is left out rather than sent as `()`.
 */
export function conjunction(
  typed: readonly string[],
  raw: readonly string[],
): string {
  const written = raw.filter((part) => part.trim() !== "");
  return [...typed, ...written.map((part) => `(${part})`)].join(" AND ");
}
