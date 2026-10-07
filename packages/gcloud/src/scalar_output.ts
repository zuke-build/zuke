// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading a value out of a `gcloud` command's stdout.
 *
 * Internal to the package: not exported from `mod.ts`. It exists so every
 * reader that returns one scalar — a token, a configured value, a service URL —
 * shares one reading of what gcloud printed, rather than each carrying its own
 * trim-and-hope.
 *
 * The design rule these readers follow is worth stating, because it is what
 * keeps them honest in an environment with no Google Cloud project to check
 * against: **no reader here parses a resource's own JSON document.** Commands
 * that would return one are given gcloud's own `value(...)` projection instead,
 * so gcloud does the extraction and this module only ever sees a bare line. A
 * parser written against an invented shape is exactly the failure the Compose
 * wrapper avoided by shipping the `--format` flag and no parser. The one JSON
 * reader, {@link readJson}, serves a listing projected to `json(insertId)`:
 * the shape it reads is gcloud's own list printer — an array, `[]` when
 * nothing matched — not a service's resource.
 *
 * @module
 */

import { GcloudOutputError } from "./errors.ts";

/** The part of a finished command a scalar reader needs. */
export interface ScalarOutput {
  /** Captured standard output. */
  stdout: string;
  /** Whether either captured stream hit the cap and lost its oldest bytes. */
  truncated: boolean;
  /** The per-stream capture cap that applied, in bytes. */
  maxCapturedBytes: number;
}

/** Refuse a capture that lost its oldest bytes: what survives begins mid-value. */
function checkComplete(output: ScalarOutput, caller: string): void {
  if (output.truncated) {
    throw new Error(
      `${caller}: gcloud produced more output than the ` +
        `${output.maxCapturedBytes}-byte capture cap kept, and capture drops ` +
        "the oldest bytes — so what survives begins mid-value. Raise the cap " +
        "with .maxCapturedBytes(bytes) for this call.",
    );
  }
}

/**
 * The single line gcloud printed, trimmed.
 *
 * Refuses two outcomes rather than returning something plausible. An empty
 * output means the command produced no value — a config key that is unset, a
 * field the resource does not carry — and returning `""` would let a build
 * interpolate emptiness into a URL or a token header. A truncated capture
 * cannot be trusted either: capture keeps the *newest* bytes, so what survives
 * begins mid-value.
 */
export function readScalar(
  output: ScalarOutput,
  caller: string,
  subject: string,
): string {
  checkComplete(output, caller);
  const value = output.stdout.trim();
  if (value === "") {
    throw new Error(
      `${caller}: gcloud printed nothing, so there is no ${subject} ` +
        "to return. That is what an unset value or a field the resource does " +
        "not carry looks like — check the command against gcloud directly.",
    );
  }
  // A `value(...)` projection emits one line per resource, so more than one
  // line means the command matched more than one thing. Returning them joined
  // would hand back a string that looks like a single value and is not — the
  // caller would put two URLs in a fetch, or two tokens in a header.
  if (/[\r\n]/.test(value)) {
    throw new Error(
      `${caller}: gcloud printed more than one line, so this is not ` +
        `one ${subject}. The command matched several resources — narrow it, ` +
        "or read the listing with the matching non-reader task.",
    );
  }
  return value;
}

/**
 * The JSON document gcloud printed, for the readers that pin `--format` to a
 * `json(...)` projection of their own. The parse error is not passed on: its
 * message quotes the text around the fault, and that text may be a log
 * entry or a secret.
 */
export function readJson(output: ScalarOutput, caller: string): unknown {
  checkComplete(output, caller);
  try {
    return JSON.parse(output.stdout);
  } catch {
    throw new GcloudOutputError(
      caller,
      "gcloud's output is not JSON. Leave --format to the reader, which " +
        "pins it.",
    );
  }
}
