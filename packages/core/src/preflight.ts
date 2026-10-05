// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Preflight: every validation in the plan gets to refuse the run before any
 * target — dependencies included — has started.
 *
 * A validation runs beside its target, which is too late for a check whose
 * job is to decide whether the run may happen at all: by then the target's
 * dependencies have run, and a validation attached after the body never
 * stands between a caller and the body. {@link Validation.preflight} is the
 * earlier seam. The executor calls it for each distinct validation in the
 * plan, once, before the run is opened; one that throws refuses the run, and
 * nothing executes. `zuke <target> --preflight` runs only this phase, which is
 * how a workflow asks "may this run?" in a step that holds no secrets, before
 * the step that does.
 *
 * @module
 */

import type { TargetBuilder, Validation } from "./target.ts";
import { resolveDuringChecks } from "./validate_during.ts";
import { redactLine } from "./ambient_redactor.ts";

/** How a preflight phase ended. */
export type PreflightOutcome =
  | { ok: true; checked: number }
  | { ok: false; target: string; error: unknown };

/**
 * The validations of `target` in the order they would run: before, during
 * (when its settings resolve — a malformed one fails the target itself), and
 * after.
 */
function validationsOf(target: TargetBuilder, name: string): Validation[] {
  let during: Validation[] = [];
  try {
    during = [...(resolveDuringChecks(target, name)?.checks ?? [])];
  } catch {
    // Reported by the target when it runs; nothing here to preflight.
  }
  return [...target.validateBefore_, ...during, ...target.validateAfter_];
}

/**
 * Run the preflight of every distinct validation the planned targets carry,
 * in plan order, each once. Stops at the first refusal.
 */
export async function runPreflights(
  order: readonly TargetBuilder[],
  runId: string,
): Promise<PreflightOutcome> {
  const seen = new Set<Validation>();
  let checked = 0;
  for (const target of order) {
    const name = target.name_ ?? "<unnamed>";
    for (const validation of validationsOf(target, name)) {
      if (seen.has(validation)) continue;
      seen.add(validation);
      if (validation.preflight === undefined) continue;
      try {
        await validation.preflight({ target: name, redact: redactLine, runId });
        checked++;
      } catch (error) {
        return { ok: false, target: name, error };
      }
    }
  }
  return { ok: true, checked };
}
