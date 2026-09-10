// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The run {@link Lifecycle}: the build's own hooks merged with any registered
 * plugins, so the scheduler can notify start/target/finish transitions without
 * knowing about plugins. A plugin is an observer — a throwing hook is reported
 * and swallowed, never allowed to change the run.
 *
 * @module
 */

import type { Build, BuildResult, TargetStatus } from "./build.ts";
import { withAmbientRedactor } from "./ambient_redactor.ts";
import type { Redactor } from "./redact.ts";
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
  redactor: Redactor,
): Lifecycle {
  // Every hook runs with the run's redactor installed as the ambient one.
  //
  // The executor's own scope covers the plan, not the calls around it, so
  // `onStart` and `onFinish` — the natural places for a build to write its own
  // job-summary section — ran outside it and published secrets in the clear.
  // Installing it here rather than at each call site is what makes that true of
  // a hook added later too: this is the one place hooks are dispatched.
  const dispatch = <T>(fn: () => Promise<T>): Promise<T> =>
    withAmbientRedactor(redactor, fn);
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
    start() {
      return dispatch(async () => {
        await build.onStart();
        await observe("onStart", (p) => p.onStart?.(run));
      });
    },
    targetStart(name) {
      return dispatch(async () => {
        await build.onTargetStart(name);
        await observe("onTargetStart", (p) => p.onTargetStart?.(name, run));
      });
    },
    targetEnd(name, status, durationMs) {
      return dispatch(async () => {
        await build.onTargetEnd(name, status);
        const timing: TargetTiming = { runId: run.runId, durationMs };
        await observe(
          "onTargetEnd",
          (p) => p.onTargetEnd?.(name, status, timing),
        );
      });
    },
    finish(result) {
      return dispatch(async () => {
        await build.onFinish(result);
        await observe("onFinish", (p) => p.onFinish?.(result, run));
      });
    },
    runStateChange(record) {
      return dispatch(async () => {
        await observe("onRunStateChange", (p) => p.onRunStateChange?.(record));
      });
    },
  };
}
