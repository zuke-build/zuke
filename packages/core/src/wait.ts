/**
 * External-event wait triggers for {@link "./target.ts".TargetBuilder.waitsFor}.
 *
 * A target can **suspend** a run until an external event occurs — an approval,
 * another system's callback — and be resumed later, in a different process. A
 * {@link WaitTrigger} decides whether that event has happened; two ship:
 * {@link externalSignal} (a named signal delivered to the run) and
 * {@link resumeWhen} (an async predicate polled on resume). The interface is
 * exported so wrapper packages can add their own triggers (e.g. "wait for a
 * GitHub workflow").
 *
 * @module
 */

import type { SignalRecord } from "./state/types.ts";
import { parseDuration } from "./duration.ts";

/**
 * Decides whether the event a target waits for has occurred. `descriptor` is a
 * short, JSON-safe label recorded on the suspended target; `isSatisfied` is
 * evaluated against the run's received signals when the target is reached and
 * again on each resume attempt.
 */
export interface WaitTrigger {
  /** A short label recorded on the wait (e.g. `signal:approved`). */
  readonly descriptor: string;
  /** Poll interval hint (ms) for predicate triggers driven by `zuke resume --check`. */
  readonly pollIntervalMs?: number;
  /** Whether the awaited event has occurred, given the run's received signals. */
  isSatisfied(
    signals: ReadonlyMap<string, SignalRecord>,
  ): boolean | Promise<boolean>;
}

/**
 * A trigger satisfied when a signal named `name` has been delivered to the run
 * (via `zuke resume <id> --signal <name>`). The signal's payload is exposed to
 * target bodies through {@link "./target.ts".TargetContext} `signals`.
 */
export function externalSignal(name: string): WaitTrigger {
  return {
    descriptor: `signal:${name}`,
    isSatisfied: (signals) => signals.has(name),
  };
}

/** Options for {@link resumeWhen}. */
export interface ResumeWhenOptions {
  /** How often `zuke resume --check` should re-evaluate the predicate. */
  interval?: string | number;
}

/**
 * A trigger satisfied when an async `check` predicate returns `true`. Zuke does
 * not poll on its own — the predicate is evaluated when the target is reached
 * and on each `zuke resume <id> --check`, so a cron or webhook nudging `--check`
 * drives it. Use it to wait on state Zuke can query (a row, a file, an API).
 */
export function resumeWhen(
  check: () => boolean | Promise<boolean>,
  options: ResumeWhenOptions = {},
): WaitTrigger {
  return {
    descriptor: "predicate",
    pollIntervalMs: options.interval === undefined
      ? undefined
      : parseDuration(options.interval),
    isSatisfied: () => check(),
  };
}
