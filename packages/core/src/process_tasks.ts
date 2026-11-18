// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `ProcessTasks`: start a process, run one to its end, and listen for the
 * signals this process receives, the same on every runtime Zuke runs on.
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
import type { Signal } from "./signal.ts";

export type {
  ChildProcess,
  ProcessOptions,
  ProcessOutput,
  ProcessStdio,
} from "./process.ts";

/** The shape of {@link ProcessTasks}. */
export interface ProcessTasksApi {
  /**
   * Start `command` and return the running child.
   *
   * @throws when the command cannot be started and the runtime knows at once.
   * Where it learns later, the child's `status` rejects.
   */
  spawn(command: string, options: ProcessOptions): ChildProcess;

  /**
   * Run `command` to its end, collecting what it writes to the streams that
   * are `piped`.
   *
   * @throws when the command cannot be started.
   */
  run(command: string, options: ProcessOptions): Promise<ProcessOutput>;

  /**
   * Call `handler` each time this process receives `signal`. On Windows only
   * `SIGINT` and `SIGBREAK` arrive.
   */
  addSignalListener(signal: Signal, handler: () => void): void;

  /** Stop calling `handler` for `signal`. */
  removeSignalListener(signal: Signal, handler: () => void): void;
}

/** Child processes and signals, on whichever runtime the build runs on. */
export const ProcessTasks: ProcessTasksApi = {
  spawn(command: string, options: ProcessOptions): ChildProcess {
    return spawnProcess(command, options);
  },

  run(command: string, options: ProcessOptions): Promise<ProcessOutput> {
    return runProcess(command, options);
  },

  addSignalListener(signal: Signal, handler: () => void): void {
    addSignalListener(signal, handler);
  },

  removeSignalListener(signal: Signal, handler: () => void): void {
    removeSignalListener(signal, handler);
  },
};
