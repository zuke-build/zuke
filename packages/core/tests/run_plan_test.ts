// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for {@link buildRunPlan} — the view of a run's resolved shape that
 * every target body and every condition reads through `ctx.plan()`.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { planGraph } from "../src/graph.ts";
import { buildRunPlan } from "../src/run_plan.ts";

/** A diamond: `base` under both `left` and `right`, both under `top`. */
class Diamond extends Build {
  base = target().executes(() => {});
  left = target().dependsOn(this.base).executes(() => {});
  right = target().dependsOn(this.base).executes(() => {});
  top = target().dependsOn(this.left, this.right).executes(() => {});
}

/** The plan for `Diamond` rooted at the named target. */
function planFor(root: "top" | "left"): ReturnType<typeof buildRunPlan> {
  const b = new Diamond();
  const targets = discoverTargets(b);
  const node = targets.get(root);
  if (node === undefined) throw new Error(`no target "${root}"`);
  const { order, predecessors } = planGraph(node);
  return buildRunPlan(order, predecessors);
}

Deno.test("the plan lists every reached target, dependencies before dependents", () => {
  // Sibling order is the graph's business (and deliberately not pinned by the
  // graph suite either); what the plan owes a reader is the full set and a
  // valid topological order.
  const targets = planFor("top").targets;
  assertEquals([...targets].sort(), ["base", "left", "right", "top"]);
  assertEquals(targets[0], "base");
  assertEquals(targets[3], "top");
});

Deno.test("includes reports the planned set, and is false for an unknown name", () => {
  const plan = planFor("top");
  assertEquals(plan.includes("base"), true);
  assertEquals(plan.includes("top"), true);
  // Probing for an optional target must not need a guard.
  assertEquals(plan.includes("nope"), false);
});

Deno.test("the plan covers only what the root reaches", () => {
  // Rooted at `left`, the run never planned `right` or `top` — so a body
  // deciding whether its work is needed gets the answer for *this* run, not for
  // everything the build could do.
  const plan = planFor("left");
  assertEquals(plan.targets, ["base", "left"]);
  assertEquals(plan.includes("right"), false);
  assertEquals(plan.includes("top"), false);
});

Deno.test("dependenciesOf reports a target's direct predecessors", () => {
  const plan = planFor("top");
  assertEquals([...plan.dependenciesOf("top")].sort(), ["left", "right"]);
  assertEquals(plan.dependenciesOf("left"), ["base"]);
  // A root of the graph has none, and so does a name that is not in the plan —
  // which is why `includes` is the way to tell those two apart.
  assertEquals(plan.dependenciesOf("base"), []);
  assertEquals(plan.dependenciesOf("nope"), []);
});

Deno.test("the plan honours soft ordering edges", () => {
  // `before`/`after` are part of what determines when a target may start, so a
  // plan that reported only hard dependencies would understate the constraint.
  class B extends Build {
    a = target().executes(() => {});
    b = target().after(this.a).executes(() => {});
    root = target().dependsOn(this.a, this.b).executes(() => {});
  }
  const instance = new B();
  const targets = discoverTargets(instance);
  const root = targets.get("root");
  if (root === undefined) throw new Error("no root");
  const { order, predecessors } = planGraph(root);
  const plan = buildRunPlan(order, predecessors);
  assertEquals(plan.targets, ["a", "b", "root"]);
  assertEquals(plan.dependenciesOf("b"), ["a"]);
});

Deno.test("the plan is deterministic across builds of the same graph", () => {
  // Every body and condition in a run reads one plan, and a resumed run rebuilds
  // it in another process — so two plans of the same graph must not disagree.
  assertEquals(planFor("top").targets, planFor("top").targets);
  assertEquals(
    planFor("top").dependenciesOf("top"),
    planFor("top").dependenciesOf("top"),
  );
});
