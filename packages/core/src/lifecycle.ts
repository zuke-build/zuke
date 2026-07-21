/**
 * The run {@link Lifecycle}: the build's own hooks merged with any registered
 * plugins, so the scheduler can notify start/target/finish transitions without
 * knowing about plugins. A plugin is an observer — a throwing hook is reported
 * and swallowed, never allowed to change the run.
 *
 * @module
 */

import type { Build, BuildResult, TargetStatus } from "./build.ts";
import type { Plugin, RunInfo, TargetTiming } from "./plugin.ts";
import type { RunRecord } from "./state/types.ts";
import { errorMessage } from "./run_support.ts";

/**
 * The merged lifecycle: the build's own hooks plus any registered plugins,
 * invoked in order (build first, then each plugin). The run functions call
 * through this so they need not know about plugins.
 */
export interface Lifecycle {
  /** Run the build's and plugins' `onStart` hooks. */
  start(): Promise<void>;
  /** Run the `onTargetStart` hooks for a target. */
  targetStart(name: string): Promise<void>;
  /** Run the `onTargetEnd` hooks for a settled target. */
  targetEnd(
    name: string,
    status: TargetStatus,
    durationMs: number,
  ): Promise<void>;
  /** Run the `onFinish` hooks with the final result. */
  finish(result: BuildResult): Promise<void>;
  /** Notify plugins of a run-level durable status change (no-op without a store). */
  runStateChange(record: RunRecord): Promise<void>;
}

/**
 * Compose a build and its plugins into one {@link Lifecycle}. The run's
 * {@link RunInfo} is bound in, so it enriches every plugin hook without threading
 * it through each call site; the build's own hooks keep their original
 * signatures. Plugin hooks that ignore the extra arguments stay compatible.
 *
 * A plugin is an **observer** — its contract is to report, time, or notify, not
 * to change a target's result — so a throwing plugin hook is caught and reported
 * through `warn`, never allowed to break the run. The build's own hooks are the
 * build's logic and still propagate.
 */
export function makeLifecycle(
  build: Build,
  plugins: Plugin[],
  run: RunInfo,
  warn: (message: string) => void,
): Lifecycle {
  const observe = async (
    hook: string,
    call: (p: Plugin) => void | Promise<void>,
  ): Promise<void> => {
    for (const p of plugins) {
      try {
        await call(p);
      } catch (error) {
        warn(
          `plugin "${p.name ?? "?"}" threw in ${hook}: ${
            errorMessage(error) ?? "unknown error"
          } (ignored — plugins observe, they do not change the run)`,
        );
      }
    }
  };
  return {
    async start() {
      await build.onStart();
      await observe("onStart", (p) => p.onStart?.(run));
    },
    async targetStart(name) {
      await build.onTargetStart(name);
      await observe("onTargetStart", (p) => p.onTargetStart?.(name, run));
    },
    async targetEnd(name, status, durationMs) {
      await build.onTargetEnd(name, status);
      const timing: TargetTiming = { runId: run.runId, durationMs };
      await observe(
        "onTargetEnd",
        (p) => p.onTargetEnd?.(name, status, timing),
      );
    },
    async finish(result) {
      await build.onFinish(result);
      await observe("onFinish", (p) => p.onFinish?.(result, run));
    },
    async runStateChange(record) {
      await observe("onRunStateChange", (p) => p.onRunStateChange?.(record));
    },
  };
}
