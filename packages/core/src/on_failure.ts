// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Resolving the run's `.onFailure(...)` dispositions — what each target's
 * failure does to the run — once, before anything runs.
 *
 * Each disposition is user code (a thunk), so it is evaluated exactly once,
 * here, behind a guard. Evaluating it again when a target fails would put user
 * code inside the scheduler's settle path, where a throw strands the run
 * `running`, and would let a thunk that answers differently the second time
 * bypass the state-store check made at setup.
 *
 * @module
 */

import { TargetBuilder } from "./target.ts";
import { messageOf } from "./internal.ts";

/** A disposition that cancels the run: plainly, or after a named compensation. */
export type CancellingDisposition = "cancel-run" | TargetBuilder;

/** The outcome of {@link resolveFailureDispositions}. */
export type FailureResolution =
  | {
    ok: true;
    /** Every target whose failure cancels the run, by name, and how. */
    cancelling: ReadonlyMap<string, CancellingDisposition>;
  }
  | { ok: false; error: Error };

/** A resolution failure naming the target and what to do about it. */
function refuse(name: string, problem: string): FailureResolution {
  return {
    ok: false,
    error: new Error(`Target "${name}" .onFailure(...) ${problem}`),
  };
}

/**
 * Evaluate every `.onFailure(...)` thunk in `order` once and validate what it
 * returned. A thunk that throws, returns something other than `"fail"`,
 * `"cancel-run"` or a target declared on the build, names its own target, or is
 * paired with `.proceedAfterFailure()` refuses the run with a message naming
 * the target.
 */
export function resolveFailureDispositions(
  order: readonly TargetBuilder[],
): FailureResolution {
  const cancelling = new Map<string, CancellingDisposition>();
  for (const t of order) {
    if (t.onFailure_ === undefined) continue;
    const name = t.name_ ?? "<unnamed>";
    // Typed `unknown` on purpose: the thunk is user code, and a forward
    // reference or an untyped caller can hand back anything at run time.
    let disposition: unknown;
    try {
      disposition = t.onFailure_();
    } catch (error) {
      return refuse(name, `threw: ${messageOf(error)}`);
    }
    if (disposition === "fail") continue;
    if (t.proceedAfterFailure_) {
      return refuse(
        name,
        "cancels the run, but the target is also .proceedAfterFailure(), " +
          "which asks for the run to keep going. Declare one or the other.",
      );
    }
    if (disposition === "cancel-run") {
      cancelling.set(name, disposition);
      continue;
    }
    if (!(disposition instanceof TargetBuilder)) {
      return refuse(
        name,
        `returned ${String(disposition)} — it must return "fail", ` +
          `"cancel-run", or a target declared on this build.`,
      );
    }
    if (disposition === t) {
      return refuse(
        name,
        "names the target itself, which would re-run the body that just " +
          'failed as its own rollback. Use "cancel-run", or name a ' +
          "separate compensation target.",
      );
    }
    if (disposition.name_ === undefined) {
      return refuse(
        name,
        "names a target that is not declared on this build. Declare the " +
          "compensation as a field of the build and return it from the thunk.",
      );
    }
    cancelling.set(name, disposition);
  }
  return { ok: true, cancelling };
}
