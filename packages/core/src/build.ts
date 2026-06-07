/**
 * The {@link Build} base class and target discovery.
 *
 * Users extend `Build` and declare targets as instance properties. After the
 * subclass is constructed, {@link discoverTargets} introspects the instance's
 * own enumerable properties to find every {@link TargetBuilder} and bind it to
 * its property name.
 */

import { TargetBuilder } from "./target.ts";

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
}

/**
 * Discover all targets declared on a build instance.
 *
 * Scans the instance's own enumerable properties (the class fields) for
 * {@link TargetBuilder} values, assigns each its property name, and returns a
 * name → target map preserving declaration order.
 *
 * @throws if two properties somehow reference the same builder instance under
 *   different names (a programming error that would corrupt naming).
 */
export function discoverTargets(build: Build): Map<string, TargetBuilder> {
  const targets = new Map<string, TargetBuilder>();
  for (const [key, value] of Object.entries(build)) {
    if (value instanceof TargetBuilder) {
      if (value.name_ !== undefined && value.name_ !== key) {
        throw new Error(
          `Target instance is bound to two names: "${value.name_}" and "${key}". ` +
            `Each target() must be assigned to exactly one property.`,
        );
      }
      value.name_ = key;
      targets.set(key, value);
    }
  }
  return targets;
}
