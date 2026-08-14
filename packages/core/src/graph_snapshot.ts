// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The run record's graph-shape snapshot, and the comparison the recovery paths
 * make against it.
 *
 * A run records the shape of the graph it planned so a later process can tell
 * whether it is still looking at the same build. Both readers of that snapshot —
 * a resume, which refuses to continue into a changed graph, and a reap, which
 * refuses to settle a run whose shape it does not recognise — ask the same
 * question, so they ask it through the same two functions rather than each
 * re-deriving the format.
 *
 * Module-internal: deliberately not re-exported from `mod.ts`.
 *
 * @module
 */

import type { TargetBuilder } from "./target.ts";
import type { RunGraphNode } from "./state/types.ts";

/**
 * The graph-shape snapshot for a planned `order`: each target's name and the
 * names of its direct dependencies, in declaration order.
 */
export function runGraphSnapshot(
  order: readonly TargetBuilder[],
): RunGraphNode[] {
  return order.map((target) => ({
    name: target.name_ ?? "",
    dependsOn: target.dependsOn_.map((dependency) => dependency.name_ ?? "")
      .filter((name) => name !== ""),
  }));
}

/**
 * How `current` differs from a recorded `snapshot`, as one phrase per difference
 * (`removed "x"`, `added "y"`, `re-wired "z"`). An empty list means the two
 * describe the same shape.
 *
 * Dependency order is not part of the shape — the scheduler decides that — so
 * only the membership of each target's dependency list is compared.
 */
export function graphDrift(
  snapshot: readonly RunGraphNode[],
  current: readonly RunGraphNode[],
): string[] {
  const drift: string[] = [];
  const snap = new Map(snapshot.map((n) => [n.name, n.dependsOn]));
  const cur = new Map(current.map((n) => [n.name, n.dependsOn]));
  for (const name of snap.keys()) {
    if (!cur.has(name)) drift.push(`removed "${name}"`);
  }
  for (const [name, deps] of cur) {
    const before = snap.get(name);
    if (before === undefined) drift.push(`added "${name}"`);
    else if (!sameMembers(before, deps)) drift.push(`re-wired "${name}"`);
  }
  return drift;
}

/** Whether two string lists have the same members (order-insensitive). */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
