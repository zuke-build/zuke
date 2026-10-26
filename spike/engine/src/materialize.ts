// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Turn a worker's manifest into a `Build` subclass the engine can run: one
 * `target()` field per manifest target, each body forwarding to the worker.
 *
 * @module
 */

import {
  Build,
  type BuildResult,
  target,
  type TargetBuilder,
} from "@zuke/core";
import type { WorkerHost } from "./host.ts";
import type { Manifest } from "./protocol.ts";

/** What a materialised build needs from its host. */
export interface TargetRunner {
  /** Run the named target's body; reject when it fails. */
  runTarget: WorkerHost["runTarget"];
  /** Tell the worker the run is over. */
  finish: WorkerHost["finish"];
}

/**
 * Build the class. Dependencies must be declared before the targets that use
 * them, mirroring the forward-reference rule of a `zuke.ts` build; a violation
 * throws from the constructor with the offending target named.
 */
export function materialize(
  manifest: Manifest,
  runner: TargetRunner,
): new () => Build {
  return class RemoteBuild extends Build {
    constructor() {
      super();
      const builders = new Map<string, TargetBuilder>();
      for (const t of manifest.targets) {
        if (builders.has(t.name)) {
          throw new Error(`manifest: target "${t.name}" is declared twice`);
        }
        const deps = t.dependsOn.map((dep) => {
          const builder = builders.get(dep);
          if (builder === undefined) {
            throw new Error(
              `manifest: target "${t.name}" depends on "${dep}", which is ` +
                `not declared before it`,
            );
          }
          return builder;
        });
        const builder = target().description(t.description).dependsOn(...deps)
          .executes((ctx) => runner.runTarget(t.name, ctx));
        builders.set(t.name, builder);
        Object.defineProperty(this, t.name, {
          value: builder,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }

    override onFinish(result: BuildResult): Promise<void> {
      return runner.finish(result.ok ? 0 : 1);
    }
  };
}
