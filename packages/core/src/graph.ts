/**
 * Dependency-graph construction: validation, cycle detection, transitive
 * closure, and topological sort.
 *
 * Edges come from three sources:
 *   - `.dependsOn(D)` on N  → hard edge `D → N` (D runs before N). Determines
 *     which targets are pulled into the execution set.
 *   - `.after(A)` on N      → soft edge `A → N`, applied only when both are in
 *     the plan. Does not pull A into the set.
 *   - `.before(B)` on N     → soft edge `N → B`, applied only when both are in
 *     the plan. Does not pull B into the set.
 */

import type { TargetBuilder } from "./target.ts";

/** Raised when the build graph is invalid (cycle or unknown dependency). */
export class GraphError extends Error {
  override name = "GraphError";
}

/** Human label for a target, falling back to a placeholder if unbound. */
function label(t: TargetBuilder | undefined): string {
  return t?.name_ ?? "<unnamed target>";
}

/**
 * Validate that every `.dependsOn(...)` reference is a discovered target.
 *
 * A reference is "unknown" if the builder was never assigned to a property of
 * the build (so it has no name), or if it is not present in the discovered map.
 *
 * @throws {GraphError} on the first unknown dependency.
 */
export function validateReferences(
  targets: Map<string, TargetBuilder>,
): void {
  const known = new Set(targets.values());
  for (const [name, t] of targets) {
    for (const dep of t.dependsOn_) {
      if (dep === undefined) {
        throw new GraphError(
          `Target "${name}" has an undefined dependency. This usually means it ` +
            `references a sibling via this.x that is declared *after* it — ` +
            `class fields initialise top-to-bottom, so dependencies must be ` +
            `declared before the targets that depend on them.`,
        );
      }
      if (!known.has(dep)) {
        throw new GraphError(
          `Target "${name}" depends on a target that was not discovered ` +
            `(${label(dep)}). Dependencies must reference sibling targets ` +
            `declared as properties of the build.`,
        );
      }
    }
  }
}

/**
 * Detect a cycle in the hard-dependency (`dependsOn`) graph across all targets.
 *
 * @returns the cycle as a path of names (e.g. `["a", "b", "a"]`) or `null`.
 */
export function findCycle(
  targets: Map<string, TargetBuilder>,
): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<TargetBuilder, number>();
  const stack: TargetBuilder[] = [];

  const visit = (node: TargetBuilder): string[] | null => {
    color.set(node, GRAY);
    stack.push(node);
    for (const dep of node.dependsOn_) {
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        // Found a back-edge: extract the cycle from the stack.
        const start = stack.indexOf(dep);
        const cycle = stack.slice(start).map(label);
        cycle.push(label(dep));
        return cycle;
      }
      if (c === WHITE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  };

  for (const t of targets.values()) {
    if ((color.get(t) ?? WHITE) === WHITE) {
      const cycle = visit(t);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * Validate the whole graph: unknown references first, then cycles.
 *
 * @throws {GraphError} with a descriptive message including the cycle path.
 */
export function validateGraph(targets: Map<string, TargetBuilder>): void {
  validateReferences(targets);
  const cycle = findCycle(targets);
  if (cycle) {
    throw new GraphError(
      `Dependency cycle detected: ${cycle.join(" → ")}`,
    );
  }
}

/**
 * Compute the execution set for a requested target: the target plus the
 * transitive closure of its hard dependencies.
 */
export function executionSet(root: TargetBuilder): Set<TargetBuilder> {
  const set = new Set<TargetBuilder>();
  const walk = (node: TargetBuilder) => {
    if (set.has(node)) return;
    set.add(node);
    for (const dep of node.dependsOn_) walk(dep);
  };
  walk(root);
  return set;
}

/**
 * Build the "must run before" edges within the execution set for `root`. An
 * edge `from → to` means `from` runs before `to`. Shared by {@link plan} and
 * {@link planGraph}.
 */
function planEdges(
  root: TargetBuilder,
): { set: Set<TargetBuilder>; edges: Map<TargetBuilder, Set<TargetBuilder>> } {
  const set = executionSet(root);
  const edges = new Map<TargetBuilder, Set<TargetBuilder>>();
  for (const node of set) edges.set(node, new Set());
  const addEdge = (from: TargetBuilder, to: TargetBuilder) => {
    const fromEdges = edges.get(from);
    if (fromEdges && set.has(to)) fromEdges.add(to);
  };

  for (const node of set) {
    for (const dep of node.dependsOn_) addEdge(dep, node); // dep before node
    for (const b of node.before_) addEdge(node, b); // node before b
    for (const a of node.after_) addEdge(a, node); // a before node
  }
  return { set, edges };
}

/**
 * Deterministic DFS post-order topological sort over the precomputed edges.
 * Iterates in declaration order (insertion order of `set`) so output is stable.
 *
 * @throws {GraphError} if the planned graph contains a cycle.
 */
function topoOrder(
  set: Set<TargetBuilder>,
  edges: Map<TargetBuilder, Set<TargetBuilder>>,
): TargetBuilder[] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<TargetBuilder, number>();
  const order: TargetBuilder[] = [];
  const stack: TargetBuilder[] = [];

  const visit = (node: TargetBuilder) => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        const start = stack.indexOf(next);
        const cycle = stack.slice(start).map(label);
        cycle.push(label(next));
        throw new GraphError(
          `Dependency cycle detected: ${cycle.join(" → ")}`,
        );
      }
      if (c === WHITE) visit(next);
    }
    stack.pop();
    color.set(node, BLACK);
    order.push(node);
  };

  for (const node of set) {
    if ((color.get(node) ?? WHITE) === WHITE) visit(node);
  }
  // Post-order DFS yields reverse topological order; flip it so that every
  // "must run before" edge points forward.
  order.reverse();
  return order;
}

/**
 * Topologically sort the execution set for `root`, honouring hard dependencies
 * and the soft `before`/`after` ordering hints (the latter only between nodes
 * that are both in the set).
 *
 * @returns target builders in a valid execution order.
 * @throws {GraphError} if the planned graph contains a cycle (which can happen
 *   via soft edges even when the hard graph is acyclic).
 */
export function plan(root: TargetBuilder): TargetBuilder[] {
  const { set, edges } = planEdges(root);
  return topoOrder(set, edges);
}

/**
 * A linearised plan plus, for each target, the targets that must finish before
 * it may start. The predecessors drive parallel scheduling; the order gives a
 * deterministic listing (e.g. for the build summary).
 */
export interface ExecutionPlan {
  /** Targets in a valid, deterministic execution order. */
  order: TargetBuilder[];
  /** For each target, the targets that must complete before it can run. */
  predecessors: Map<TargetBuilder, TargetBuilder[]>;
}

/**
 * Plan the execution set for `root` for scheduling: the deterministic order
 * plus each target's direct predecessors (hard dependencies and the applicable
 * soft `before`/`after` edges).
 *
 * @throws {GraphError} if the planned graph contains a cycle.
 */
export function planGraph(root: TargetBuilder): ExecutionPlan {
  const { set, edges } = planEdges(root);
  const order = topoOrder(set, edges);
  const predecessors = new Map<TargetBuilder, TargetBuilder[]>();
  for (const node of set) predecessors.set(node, []);
  for (const [from, tos] of edges) {
    for (const to of tos) predecessors.get(to)?.push(from);
  }
  return { order, predecessors };
}
