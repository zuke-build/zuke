// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The resolved shape of a run — which targets it plans and how they relate —
 * as read by a target body and by a condition.
 *
 * @module
 */

import type { TargetBuilder } from "./target.ts";

/**
 * The resolved shape of this run: the targets it plans, in order, and the
 * dependencies between them.
 *
 * **This describes the plan, not the outcome.** A target is in the plan because
 * the graph put it there; it may still be skipped by a condition, by
 * `--affected`, or by an operator's forced outcome, and a run that fails early
 * never reaches its later targets at all. Ask {@link RunPlan.includes} what the
 * run set out to do, and `ctx.outcomeOf(...)` what actually became of a target
 * once it settled.
 *
 * The plan is fixed for the whole run: every body and every condition, in every
 * process a resumed run passes through, reads the same answer.
 */
export interface RunPlan {
  /**
   * Every planned target's dotted name, in the run's deterministic execution
   * order — the same order the build summary lists.
   */
  readonly targets: readonly string[];
  /**
   * Whether `target` is part of this run's planned set.
   *
   * The question a body asks to decide whether its work is needed by something
   * else in the run — "am I building for a `deploy` that was actually asked
   * for?". An unknown name is `false`, never an error, so probing for an
   * optional target does not need a guard.
   */
  includes(target: string): boolean;
  /**
   * The targets that must complete before `target` may start: its declared
   * dependencies plus the soft `before`/`after` edges that apply within this
   * run's set.
   *
   * Empty for a target with no predecessors **and** for a name that is not in
   * the plan — use {@link RunPlan.includes} to tell those apart.
   */
  dependenciesOf(target: string): readonly string[];
}

/**
 * Build the immutable {@link RunPlan} for a planned graph.
 *
 * Internal to the engine: the plan is constructed once per run, from
 * `planGraph`'s output, and handed to every body and condition.
 *
 * @param order the planned targets, in execution order.
 * @param predecessors each target's direct predecessors.
 * @returns a plan reporting those targets by dotted name.
 */
export function buildRunPlan(
  order: readonly TargetBuilder[],
  predecessors: ReadonlyMap<TargetBuilder, TargetBuilder[]>,
): RunPlan {
  const nameOf = (t: TargetBuilder): string => t.name_ ?? "<unnamed>";
  const targets = order.map(nameOf);
  const planned = new Set(targets);
  const deps = new Map<string, readonly string[]>();
  for (const t of order) {
    deps.set(nameOf(t), (predecessors.get(t) ?? []).map(nameOf));
  }
  return {
    targets,
    includes: (target) => planned.has(target),
    dependenciesOf: (target) => deps.get(target) ?? [],
  };
}
