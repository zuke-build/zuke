// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link raceSignal}: stop waiting for a promise when a signal fires — the
 * one way a call's own timeout and cancellation reach a wait that was not
 * started with its signal (a shared token fetch, a user's credential source).
 *
 * @module
 */

/**
 * `promise`, or a rejection with `signal`'s reason as soon as it fires —
 * whichever comes first. The promise itself is left to settle on its own; a
 * rejection it settles with afterwards is observed, never unhandled.
 */
export function raceSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", abort)
    );
  });
}
