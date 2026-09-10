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
 * The resolved shape of this run: the class-field targets it plans, in order,
 * and the dependencies between them.
 *
 * **This describes the plan, not the outcome.** A target is in the plan because
 * the graph put it there; it may still be skipped by a condition, by
 * `--affected`, or by an operator's forced outcome, and a run that fails early
 * never reaches its later targets at all. Ask {@link RunPlan.includes} what the
 * run set out to do, and `ctx.outcomeOf(...)` what actually became of a target
 * once it settled.
 *
 * **Two things the plan is not.**
 *
 * It is not every target that will appear in the run record. A `.forEach()`
 * fan-out expands into its sub-targets while the run executes, long after the
 * graph is planned, so `fan[us].prep` has an outcome and a summary row but is
 * **absent** from the plan — only the `fan` target that produced it is in
 * there. For a fan-out, `outcomeOf` sees more than `includes` does.
 *
 * It is not a promise that holds across processes. The plan is the graph **as
 * this process resolved it**, and it is fixed for the whole of this process: two
 * bodies, and both evaluations of a condition, always agree. A second process —
 * a resume, or a `zuke cancel` running compensations — re-resolves the graph
 * from the build class it was given, so it can legitimately differ: the class
 * may have changed since the run was suspended (which is what `--force-graph`
 * is for), and a lazy `orderWith` provider may answer differently or, if it is
 * unreachable, be degraded to the base topological order.
 */
export interface RunPlan {
  /**
   * Every planned target's dotted name, in the run's deterministic execution
   * order.
   *
   * The build summary can list **more** rows than this: a `.forEach()` fan-out's
   * sub-targets are created during execution and get their own rows, but are
   * not part of the planned graph.
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
   * The targets that must complete before `target` may start: everything the
   * planner treats as a predecessor — declared `dependsOn` dependencies, the
   * targets this one `triggers`, and the soft `before`/`after`, `extraEdges`
   * and `orderWith` edges that apply within this run's set.
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
  // Frozen, not copied per call: one plan is shared by every body in the run,
  // and bodies run concurrently. `readonly` is erased at runtime, so without
  // this a body that sorts the array it was handed — or any JavaScript consumer,
  // where `readonly` does not exist at all — silently reorders or truncates what
  // every other body reads. Freezing turns that into a loud TypeError instead.
  const targets = Object.freeze(order.map(nameOf));
  const planned = new Set(targets);
  // Read from the map's own entries rather than looking each target up by key:
  // `planGraph` seeds an entry for every node in the planned set, so a lookup
  // would be total and its `undefined` arm unreachable. Iterating leaves no arm
  // to be wrong about.
  const deps = new Map<string, readonly string[]>();
  for (const [t, predecessorsOf] of predecessors) {
    deps.set(nameOf(t), Object.freeze(predecessorsOf.map(nameOf)));
  }
  const none: readonly string[] = Object.freeze([]);
  return {
    targets,
    includes: (target) => planned.has(target),
    dependenciesOf: (target) => deps.get(target) ?? none,
  };
}
