// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `ProcessTasks`: start a process, run one to its end, and listen for the
 * signals this process receives, the same on every runtime Zuke runs on. A
 * child is configured through a {@link ProcessSettings} lambda:
 *
 * ```ts
 * import { ProcessTasks } from "@zuke/core";
 *
 * const { stdout } = await ProcessTasks.run("git", (s) =>
 *   s.args("rev-parse", "HEAD").stdout("piped"));
 * ```
 *
 * For a command a build runs as a step, reach for the shell `$` or a tool
 * wrapper: they echo, redact and honour a dry run. These are the lower layer a
 * package needs when it manages a child itself, such as a worker it talks to
 * or a build it forwards to.
 *
 * @module
 */

import {
  addSignalListener,
  type ChildProcess,
  type ProcessOptions,
  type ProcessOutput,
  removeSignalListener,
  runProcess,
  spawnProcess,
} from "./process.ts";
import { ProcessSettings } from "./process_settings.ts";
import type { Signal } from "./signal.ts";
import type { Configure } from "./tooling.ts";

export type { ChildProcess, ProcessOutput, ProcessStdio } from "./process.ts";

/** What `configure` sets, as core's process layer starts a child with it. */
function optionsOf(configure: Configure<ProcessSettings>): ProcessOptions {
  const s = configure(new ProcessSettings());
  return {
    args: s.args_,
    cwd: s.cwd_,
    env: s.env_,
    clearEnv: s.clearEnv_,
    stdin: s.stdin_,
    stdout: s.stdout_,
    stderr: s.stderr_,
    signal: s.signal_,
  };
}

/** Settings left as they are: what a call with no lambda starts with. */
const DEFAULTS: Configure<ProcessSettings> = (s) => s;

/** The shape of {@link ProcessTasks}. */
export interface ProcessTasksApi {
  /**
   * Start `command` and return the running child.
   *
   * @throws when the command cannot be started and the runtime knows at once.
   * Where it learns later, the child's `status` rejects.
   */
  spawn(command: string, configure?: Configure<ProcessSettings>): ChildProcess;

  /**
   * Run `command` to its end, collecting what it writes to the streams that
   * are `piped`.
   *
   * @throws when the command cannot be started.
   */
  run(
    command: string,
    configure?: Configure<ProcessSettings>,
  ): Promise<ProcessOutput>;

  /**
   * Call `handler` each time this process receives `signal`. On Windows only
   * `SIGINT` and `SIGBREAK` arrive, and Deno refuses a listener for any other
   * there, so a portable caller listens for those two on Windows.
   */
  addSignalListener(signal: Signal, handler: () => void): void;

  /** Stop calling `handler` for `signal`. */
  removeSignalListener(signal: Signal, handler: () => void): void;
}

/** Child processes and signals, on whichever runtime the build runs on. */
export const ProcessTasks: ProcessTasksApi = {
  spawn(
    command: string,
    configure: Configure<ProcessSettings> = DEFAULTS,
  ): ChildProcess {
    return spawnProcess(command, optionsOf(configure));
  },

  run(
    command: string,
    configure: Configure<ProcessSettings> = DEFAULTS,
  ): Promise<ProcessOutput> {
    return runProcess(command, optionsOf(configure));
  },

  addSignalListener(signal: Signal, handler: () => void): void {
    addSignalListener(signal, handler);
  },

  removeSignalListener(signal: Signal, handler: () => void): void {
    removeSignalListener(signal, handler);
  },
};
