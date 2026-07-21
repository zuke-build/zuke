/**
 * Resolving a target's `.waitsFor(...)` gate: run its settings lambda, evaluate
 * the trigger against the run's signals, and build the {@link WaitState} to
 * record if the run must suspend. Distinct from `./wait.ts`, which defines the
 * user-facing wait spec and {@link WaitContext} this consumes.
 *
 * @module
 */

import { type OnTimeout, WaitSettings } from "./target.ts";
import type { WaitContext } from "./wait.ts";
import type { WaitDisposition, WaitState } from "./state/types.ts";
import type { Configure } from "./tooling.ts";
import { inMemoryStateHandle } from "./state/writer.ts";
import { parseDuration } from "./duration.ts";
import type { RunEnv } from "./run_support.ts";

/** Resolve a timeout thunk to a JSON-serialisable disposition (default `"fail"`). */
function resolveDisposition(thunk: OnTimeout | undefined): WaitDisposition {
  if (thunk === undefined) return "fail";
  const disposition = thunk();
  if (disposition === "fail" || disposition === "cancel-run") {
    return disposition;
  }
  return { target: disposition.name_ ?? "?" };
}

/** The outcome of evaluating a target's `.waitsFor(...)` gate. */
export interface WaitResolution {
  /** Whether the trigger is already satisfied (the gate passes immediately). */
  satisfied: boolean;
  /** The state to persist when the run suspends on this gate. */
  waitState: WaitState;
  /** A human-readable description of what the gate waits on. */
  descriptor: string;
}

/**
 * Run a target's wait settings lambda, evaluate its trigger against the run's
 * signals, and build the {@link WaitState} to record if it must suspend.
 */
export async function resolveWait(
  configure: Configure<WaitSettings>,
  env: RunEnv,
  name: string,
): Promise<WaitResolution> {
  const settings = configure(new WaitSettings());
  const trigger = settings.trigger_;
  if (trigger === undefined) {
    throw new Error(
      `Target "${name}" .waitsFor(...) set no trigger — call s.on(...).`,
    );
  }
  // The trigger gets the target's durable state handle, so a stateful trigger
  // (e.g. dispatch-then-poll) can persist correlation state across the
  // suspend/resume boundary and hand a result to the body.
  const waitCtx: WaitContext = {
    state: env.writer ? env.writer.stateHandle(name) : inMemoryStateHandle(),
    runId: env.runId,
    target: name,
  };
  const satisfied = await trigger.isSatisfied(env.signals, waitCtx);
  const waitState: WaitState = {
    trigger: trigger.descriptor,
    onTimeout: resolveDisposition(settings.onTimeout_),
  };
  if (settings.timeout_ !== undefined) {
    // Preserve the deadline first recorded when this wait suspended: a resume
    // that re-suspends the same still-unsatisfied gate must not push the
    // deadline forward, or an hourly `resume --check` cron would reset the
    // timeout every hour and it would never fire. Only compute a fresh deadline
    // when there is no prior one (the first suspend).
    const priorDeadline = env.priorWaits?.get(name)?.deadline;
    waitState.deadline = priorDeadline ??
      new Date(Date.now() + parseDuration(settings.timeout_)).toISOString();
  }
  return { satisfied, waitState, descriptor: trigger.descriptor };
}
