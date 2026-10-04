// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `.validateDuring(...)`: run a target's checks on an interval while its body
 * runs, and stop the body at the first one that fails.
 *
 * The checks get the same {@link ValidationContext} as a `validateBefore` or
 * `validateAfter` — the target's name and the run's redactor — so a check that
 * publishes what it found, such as a canary analysis posting to a pull request,
 * masks secrets the same way wherever it runs.
 *
 * @module
 */

import {
  type TargetBuilder,
  ValidateDuringSettings,
  type Validation,
} from "./target.ts";
import { parseDuration } from "./duration.ts";
import { redactLine } from "./ambient_redactor.ts";
import { withAmbientSignal } from "./ambient_signal.ts";

/** The longest delay `setTimeout` honours: 2^31 - 1 ms. */
const MAX_INTERVAL_MS = 2_147_483_647;

/** A target's resolved in-flight checks: how often, and which. */
export interface DuringChecks {
  /** The interval between rounds, in milliseconds. */
  intervalMs: number;
  /** The validations each round runs, in order. */
  checks: readonly Validation[];
}

/**
 * Run `t`'s `.validateDuring(...)` lambda and validate what it set, or return
 * `undefined` when the target declares none. Runs when the target starts, so
 * the lambda may read resolved parameters.
 *
 * @throws a friendly error naming the target when no interval or no check was
 * set, or the interval is not positive.
 */
export function resolveDuringChecks(
  t: TargetBuilder,
  name: string,
): DuringChecks | undefined {
  if (t.validateDuring_ === undefined) return undefined;
  const settings = t.validateDuring_(new ValidateDuringSettings());
  if (settings.every_ === undefined) {
    throw new Error(
      `Target "${name}" .validateDuring(...) set no interval — call s.every(...).`,
    );
  }
  if (settings.checks_.length === 0) {
    throw new Error(
      `Target "${name}" .validateDuring(...) set no checks — call s.check(...).`,
    );
  }
  const intervalMs = parseDuration(settings.every_);
  if (!(intervalMs > 0)) {
    throw new Error(
      `Target "${name}" .validateDuring(...) needs a positive interval, got ` +
        `${String(settings.every_)}.`,
    );
  }
  // A timer longer than this fires at once, which would turn a long interval
  // into a busy loop against whatever the checks call.
  if (intervalMs > MAX_INTERVAL_MS) {
    throw new Error(
      `Target "${name}" .validateDuring(...) interval ` +
        `${String(settings.every_)} is longer than the longest timer ` +
        `(about 24 days).`,
    );
  }
  return { intervalMs, checks: [...settings.checks_] };
}

/**
 * Run `body` while running `during`'s checks every interval, and settle with
 * the body's outcome — or, if a check throws, with that check's error.
 *
 * A failing check aborts `stop`, which the body's own signal is composed from,
 * so a cooperative body and its shell commands end; the body is installed as
 * the ambient signal's scope for that reason. The target does not wait for a
 * body that ignores the signal, exactly as a `.timeout(...)` does not. A round
 * never overlaps the next: the next interval starts when a round finishes.
 *
 * Once the body settles no further check starts. After a body that succeeded,
 * a check still running is awaited and its verdict counts — a check that goes
 * red as the body finishes still fails the target. After a body that failed,
 * the check is aborted rather than awaited: the target has its verdict. Each
 * check gets a signal that aborts with the round, and the run's cancellation
 * ends the wait for a check that ignores it, so a stuck check never holds a
 * Ctrl-C hostage.
 */
export async function runWhileValidating(
  body: () => Promise<void>,
  during: DuringChecks,
  name: string,
  stop: AbortController,
  signal: AbortSignal,
): Promise<void> {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let round: Promise<void> = Promise.resolve();
  let checkFailure: { error: unknown } | undefined;
  let fail: (error: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => (fail = reject));
  const rounds = new AbortController();
  const roundSignal = AbortSignal.any([signal, rounds.signal]);
  const context = { target: name, redact: redactLine, signal: roundSignal };

  const runRound = async (): Promise<void> => {
    for (const check of during.checks) {
      if (settled) return;
      await withAmbientSignal(
        roundSignal,
        async () => await check.validate(context),
      );
    }
  };
  const schedule = (): void => {
    if (settled) return;
    timer = setTimeout(() => {
      round = runRound().then(schedule, (error: unknown) => {
        checkFailure ??= { error };
        if (settled) return;
        settled = true;
        stop.abort();
        fail(error);
      });
    }, during.intervalMs);
  };
  const finish = (): void => {
    settled = true;
    clearTimeout(timer);
  };

  schedule();
  try {
    await Promise.race([withAmbientSignal(signal, body), failed]);
  } catch (error) {
    finish();
    rounds.abort();
    throw error;
  }
  finish();
  await settledOrAborted(round, signal);
  rounds.abort();
  if (checkFailure !== undefined) throw checkFailure.error;
}

/** Resolve once `work` settles, or `signal` aborts — whichever is first. */
function settledOrAborted(
  work: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      signal.removeEventListener("abort", done);
      resolve();
    };
    signal.addEventListener("abort", done, { once: true });
    work.then(done);
  });
}
