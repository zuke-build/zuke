// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The message of something that was thrown, for wrapping it in a canary's own
 * error.
 *
 * @module
 */

/** An error's message, or the thrown value as text. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
