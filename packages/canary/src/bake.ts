// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The two ways a canary step bakes: an inline sleep the run's cancellation
 * cuts short, and a durable gate that `zuke resume --check` reopens once the
 * bake has run its time.
 *
 * @module
 */

import type { WaitTrigger } from "@zuke/core";

/**
 * The longest delay `setTimeout` honours: 2^31 - 1 ms (about 24.8 days). A
 * longer one fires at once, so every inline wait is held under it.
 */
export const MAX_TIMER_MS = 2_147_483_647;

/** The state key a durable bake records its start under. */
const STARTED_AT = "bakeStartedAt";

/** The longest a durable bake asks to be re-checked after. */
const MAX_POLL_MS = 60_000;

/**
 * Resolve after `ms`, or as soon as `signal` aborts — then throw its reason, so
 * a cancelled bake ends the target rather than passing it.
 */
export async function bakeFor(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
  signal.throwIfAborted();
}

/**
 * A wait trigger satisfied once `ms` have passed since the gate was first
 * reached. The start is recorded in the gate's durable state, so the clock
 * keeps running across a suspend and a resume in another process; `now` is
 * the seam a test drives the clock through.
 */
export function bakeElapsed(
  ms: number,
  now: () => number = Date.now,
): WaitTrigger {
  return {
    descriptor: `bake:${ms}ms`,
    pollIntervalMs: Math.max(1000, Math.min(ms, MAX_POLL_MS)),
    async isSatisfied(_signals, context) {
      const recorded = context.state.get()[STARTED_AT];
      if (typeof recorded === "number") return now() - recorded >= ms;
      await context.state.set({ [STARTED_AT]: now() });
      return false;
    },
  };
}
