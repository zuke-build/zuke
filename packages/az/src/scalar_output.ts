// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading a value out of an `az` command's stdout — as a bare line, or as a
 * JSON document.
 *
 * Internal to the package: not exported from `mod.ts`. It exists so every
 * reader shares one reading of what the CLI printed, rather than each
 * carrying its own trim-and-hope. Two forms, and the reader picks by what it
 * reads: a value that is always one line (a subscription id, a host name) is
 * pinned to `--output tsv` and read with {@link readScalar}; anything that may
 * be absent, span lines or be a credential (a secret, an access token, a
 * deployment output) is pinned to `--output json` and read with
 * {@link readJson}, because tsv output cannot keep a multi-line value apart
 * from several values.
 *
 * @module
 */

import { AzOutputError } from "./errors.ts";

/** The part of a finished command a reader needs. */
interface ReadableOutput {
  /** Captured standard output. */
  stdout: string;
  /** Whether either captured stream hit the cap and lost its oldest bytes. */
  truncated: boolean;
  /** The per-stream capture cap that applied, in bytes. */
  maxCapturedBytes: number;
}

/**
 * Refuse a capture that lost its beginning: capture keeps the *newest*
 * bytes, so what survives starts mid-value.
 */
function checkComplete(output: ReadableOutput, task: string): void {
  if (output.truncated) {
    throw new AzOutputError(
      task,
      `the Azure CLI produced more output than the ` +
        `${output.maxCapturedBytes}-byte capture cap kept, and capture drops ` +
        "the oldest bytes — so what survives begins mid-value. Raise the cap " +
        "with .maxCapturedBytes(bytes) for this call.",
    );
  }
}

/**
 * The single line the CLI printed, trimmed.
 *
 * Refuses an empty answer — returning `""` would let a build interpolate
 * emptiness into a login or a URL — and more than one line, which means the
 * query matched more than one thing.
 */
export function readScalar(
  output: ReadableOutput,
  task: string,
  subject: string,
): string {
  checkComplete(output, task);
  const value = output.stdout.trim();
  if (value === "") {
    throw new AzOutputError(
      task,
      `the Azure CLI printed nothing, so there is no ${subject} to return.`,
    );
  }
  if (/[\r\n]/.test(value)) {
    throw new AzOutputError(
      task,
      `the Azure CLI printed more than one line, so this is not one ${subject}.`,
    );
  }
  return value;
}

/**
 * The JSON document the CLI printed. The parse error is not passed on: its
 * message quotes the text around the fault, and the text may be a secret.
 */
export function readJson(output: ReadableOutput, task: string): unknown {
  checkComplete(output, task);
  try {
    return JSON.parse(output.stdout);
  } catch {
    throw new AzOutputError(
      task,
      "the Azure CLI's output is not JSON. Leave --output to the reader, " +
        "which pins it.",
    );
  }
}
