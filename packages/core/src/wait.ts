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
import type { TargetStateHandle } from "./target.ts";
import { parseDuration } from "./duration.ts";

/**
 * The durable context a {@link WaitTrigger} may use while deciding whether its
 * event has occurred. Its {@link WaitContext.state} handle is the awaiting
 * target's persisted metadata — it **survives a suspend/resume**, even across
 * processes — so a stateful trigger (e.g. "dispatch a GitHub workflow, then poll
 * it") can remember what it started and hand a result to the target's body. The
 * built-in triggers ignore it.
 */
export interface WaitContext {
  /**
   * The awaiting target's durable state handle (the same one its body receives
   * as `ctx.state`). Reads and writes here persist with the run and are visible
   * to a later resume in another process.
   */
  readonly state: TargetStateHandle;
  /** The run id — stable across a resume, so a natural correlation key. */
  readonly runId: string;
  /** The awaiting target's dotted name. */
  readonly target: string;
}

/**
 * Decides whether the event a target waits for has occurred. `descriptor` is a
 * short, JSON-safe label recorded on the suspended target; `isSatisfied` is
 * evaluated against the run's received signals (and a durable {@link
 * WaitContext}) when the target is reached and again on each resume attempt.
 */
export interface WaitTrigger {
  /** A short label recorded on the wait (e.g. `signal:approved`). */
  readonly descriptor: string;
  /** Poll interval hint (ms) for predicate triggers driven by `zuke resume --check`. */
  readonly pollIntervalMs?: number;
  /**
   * Whether the awaited event has occurred, given the run's received signals
   * and a durable {@link WaitContext}. The context lets a trigger persist
   * correlation state across a suspend/resume; a trigger that only inspects
   * signals may ignore it (fewer parameters stay assignable).
   */
  isSatisfied(
    signals: ReadonlyMap<string, SignalRecord>,
    context: WaitContext,
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
