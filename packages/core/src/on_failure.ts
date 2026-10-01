// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Resolving a target's `.onFailure(...)` disposition — what its failure does to
 * the run. Shared by the state setup, which must know before the run whether a
 * store is needed, and by the executor, which acts on it when the target fails.
 *
 * @module
 */

import type { TargetBuilder } from "./target.ts";

/** A resolved failure disposition: fail as usual, cancel, or compensate then cancel. */
export type FailureDisposition = "fail" | "cancel-run" | TargetBuilder;

/**
 * Resolve `t`'s `.onFailure(...)` thunk, defaulting to `"fail"`. The thunk is
 * evaluated only once the build is constructed, so it may name a compensation
 * target declared below `t`.
 */
export function failureDisposition(t: TargetBuilder): FailureDisposition {
  return t.onFailure_ === undefined ? "fail" : t.onFailure_();
}

/** Whether `t`'s failure cancels the run rather than merely failing it. */
export function cancelsOnFailure(t: TargetBuilder): boolean {
  return failureDisposition(t) !== "fail";
}
