// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The message of a caught value — an `Error`'s message, anything else as a
 * string — for the credential sources that wrap a failure in their own
 * provider-and-step context.
 *
 * @module
 */

/** `error`'s message when it is an `Error`, else `error` as a string. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
