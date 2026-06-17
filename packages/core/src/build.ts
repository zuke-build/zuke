/**
 * The {@link Build} base class and target discovery.
 *
 * Users extend `Build` and declare targets as instance properties. After the
 * subclass is constructed, {@link discoverTargets} introspects the instance's
 * own enumerable properties to find every {@link TargetBuilder} and bind it to
 * its property name. Discovery recurses into plain object fields, so a reusable
 * **component** — a function returning a bundle of targets — contributes its
 * targets under a dotted path (e.g. `release.publish`).
 */

import { Group, TargetBuilder } from "./target.ts";

/** Whether a value is a plain object (a component bundle), not a class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Visit every field of a build, recursing into plain object fields (component
 * bundles). Each field is reported with its dotted path (`a`, `a.b`, …).
 */
export function forEachField(
  root: object,
  visit: (path: string, value: unknown) => void,
): void {
  const seen = new WeakSet<object>();
  const walk = (obj: object, prefix: string) => {
    if (seen.has(obj)) return;
    seen.add(obj);
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      visit(path, value);
      if (isPlainObject(value)) walk(value, path);
    }
  };
  walk(root, "");
}

/** The outcome of a single target, reported in the summary and lifecycle hooks. */
export type TargetStatus = "passed" | "failed" | "skipped" | "cached";

/** Result passed to the {@link Build.onFinish} lifecycle hook. */
export interface BuildResult {
  /** Whether every executed target succeeded. */
  ok: boolean;
  /** Names of the targets that ran, in execution order. */
  executed: string[];
  /** The error that aborted the run, if any. */
  error?: unknown;
}

/**
 * Base class for user-defined builds. Provides no targets of its own; subclasses
 * declare targets as properties. Optionally override the lifecycle hooks.
 */
export class Build {
  /** Called once before any target runs. */
  onStart(): void | Promise<void> {}

  /** Called once after the run completes (success or failure). */
  onFinish(_result: BuildResult): void | Promise<void> {}

  /** Called just before a target's body executes (not for skipped/cached). */
  onTargetStart(_name: string): void | Promise<void> {}

  /** Called after each target settles, with its final status. */
  onTargetEnd(_name: string, _status: TargetStatus): void | Promise<void> {}
}

/**
 * Discover all targets declared on a build instance.
 *
 * Scans the instance's fields (recursing into plain-object component bundles)
 * for {@link TargetBuilder} values, assigns each its dotted property path, and
 * returns a name → target map preserving declaration order.
 *
 * @throws if two properties reference the same builder instance under different
 *   names (a programming error that would corrupt naming).
 */
export function discoverTargets(build: Build): Map<string, TargetBuilder> {
  const targets = new Map<string, TargetBuilder>();
  forEachField(build, (path, value) => {
    if (value instanceof TargetBuilder) {
      if (value.name_ !== undefined && value.name_ !== path) {
        throw new Error(
          `Target instance is bound to two names: "${value.name_}" and "${path}". ` +
            `Each target() must be assigned to exactly one property.`,
        );
      }
      value.name_ = path;
      targets.set(path, value);
    }
  });
  return targets;
}

/**
 * Discover all parallel {@link Group} batches declared on a build instance,
 * binding each its property path (for labelling, e.g. in the graph). Groups
 * that are not assigned to a build property simply stay unnamed.
 */
export function discoverGroups(build: Build): Map<string, Group> {
  const groups = new Map<string, Group>();
  forEachField(build, (path, value) => {
    if (value instanceof Group) {
      value.name_ = path;
      groups.set(path, value);
    }
  });
  return groups;
}
