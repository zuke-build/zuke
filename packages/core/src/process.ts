// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one place the shell starts a child process, and the description of a
 * started child the rest of core works with. Everything above this module
 * names no runtime: it asks for a process by command and options and gets
 * back a {@link ChildProcess}.
 *
 * @module
 */

import { spawnOnNode } from "./process_node.ts";
import type { CommandStatus, Signal } from "./signal.ts";

/** How one of a child's standard streams is connected. */
export type ProcessStdio = "inherit" | "piped" | "null";

/** What a child process is started with, beyond its command. */
export interface ProcessOptions {
  /** The arguments, one per entry: nothing re-splits or re-quotes them. */
  args: string[];
  /** The working directory. Omitted: the parent's. */
  cwd?: string;
  /** Variables added to the environment the child inherits. */
  env?: Record<string, string>;
  /** The child's stdin. Omitted: inherited. */
  stdin?: ProcessStdio;
  /** The child's stdout. Omitted: inherited. */
  stdout?: ProcessStdio;
  /** The child's stderr. Omitted: inherited. */
  stderr?: ProcessStdio;
  /** Aborting it terminates the child. */
  signal?: AbortSignal;
}

/**
 * A started child process: what the shell reads, writes and waits on. A
 * stream is there to use only when its {@link ProcessStdio} was `piped`;
 * reading one that was not throws.
 */
export interface ChildProcess {
  /** The operating-system process id; `-1` for a child that never started. */
  readonly pid: number;
  /** Resolves when the process exits. Rejects if it could not be started. */
  readonly status: Promise<CommandStatus>;
  /** Deliver a signal to the process. Throws if it has already exited. */
  kill(signal?: Signal): void;
  /** The child's input. */
  readonly stdin: WritableStream<Uint8Array>;
  /** The child's output. */
  readonly stdout: ReadableStream<Uint8Array>;
  /** The child's error output. */
  readonly stderr: ReadableStream<Uint8Array>;
}

/**
 * Start `command` with `options` and return the running child. Module-internal:
 * builds run processes through the shell.
 *
 * On Deno this is `Deno.Command`, as it has always been. On any other runtime
 * it is `node:child_process`, see {@link spawnOnNode}.
 *
 * @throws when the command cannot be started and the runtime knows at once,
 * as Deno does. Where it learns later, the child's `status` rejects.
 */
export function spawnProcess(
  command: string,
  options: ProcessOptions,
): ChildProcess {
  return typeof Deno === "undefined"
    ? spawnOnNode(command, options)
    : new Deno.Command(command, options).spawn();
}
