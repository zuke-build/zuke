// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The signal an analysis's HTTP request runs under: its own timeout, and the
 * check's signal when it has one — so an in-flight check is cut short when
 * the bake ends or the run is cancelled.
 *
 * @module
 */

/** A signal that aborts after `timeoutMs`, or when `outer` does. */
export function requestSignal(
  timeoutMs: number,
  outer: AbortSignal | undefined,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return outer === undefined ? timeout : AbortSignal.any([timeout, outer]);
}
