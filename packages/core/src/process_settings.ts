// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link ProcessSettings}: how `ProcessTasks` starts a child process.
 *
 * @module
 */

import type { ProcessStdio } from "./process.ts";

/**
 * How a child process is started, for `ProcessTasks.spawn` and
 * `ProcessTasks.run`:
 *
 * ```ts
 * const output = await ProcessTasks.run("git", (s) =>
 *   s.args("rev-parse", "HEAD").cwd(repo).stdout("piped"));
 * ```
 *
 * With nothing set, the child gets no arguments, the parent's working
 * directory and environment, and inherits all three standard streams.
 */
export class ProcessSettings {
  /** The arguments; see {@link args}. */
  args_: string[] = [];

  /** The working directory; see {@link cwd}. */
  cwd_: string | undefined = undefined;

  /** Variables added to the environment; see {@link env}. */
  env_: Record<string, string> = {};

  /** Whether to start from an empty environment; see {@link clearEnv}. */
  clearEnv_ = false;

  /** How stdin is connected; see {@link stdin}. */
  stdin_: ProcessStdio = "inherit";

  /** How stdout is connected; see {@link stdout}. */
  stdout_: ProcessStdio = "inherit";

  /** How stderr is connected; see {@link stderr}. */
  stderr_: ProcessStdio = "inherit";

  /** What terminates the child when aborted; see {@link signal}. */
  signal_: AbortSignal | undefined = undefined;

  /**
   * Arguments, one per value: nothing re-splits or re-quotes them.
   * Accumulates across calls.
   */
  args(...values: string[]): this {
    this.args_.push(...values);
    return this;
  }

  /** The working directory (default: the parent's). */
  cwd(path: string): this {
    this.cwd_ = path;
    return this;
  }

  /**
   * Set `name` to `value` in the child's environment, on top of what it
   * inherits. Accumulates across calls.
   */
  env(name: string, value: string): this {
    this.env_[name] = value;
    return this;
  }

  /**
   * Start from an empty environment, so the variables set with {@link env}
   * are all the child sees. On Windows under Node the variables the system
   * needs are still passed on.
   */
  clearEnv(): this {
    this.clearEnv_ = true;
    return this;
  }

  /** How the child's stdin is connected (default `inherit`). */
  stdin(how: ProcessStdio): this {
    this.stdin_ = how;
    return this;
  }

  /**
   * How the child's stdout is connected (default `inherit`); `piped` to read
   * or collect it.
   */
  stdout(how: ProcessStdio): this {
    this.stdout_ = how;
    return this;
  }

  /**
   * How the child's stderr is connected (default `inherit`); `piped` to read
   * or collect it.
   */
  stderr(how: ProcessStdio): this {
    this.stderr_ = how;
    return this;
  }

  /** Terminate the child when `abort` is aborted. */
  signal(abort: AbortSignal): this {
    this.signal_ = abort;
    return this;
  }
}
