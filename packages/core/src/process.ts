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

import { ON_DENO } from "./runtime.ts";
import { spawnOnNode } from "./process_node.ts";
import process from "node:process";
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
  /**
   * Start from an empty environment, so `env` is the whole of what the child
   * sees and nothing the parent set for itself reaches it. On Windows under
   * Node the variables the system needs are still passed on.
   */
  clearEnv?: boolean;
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
  return ON_DENO
    ? new Deno.Command(command, options).spawn()
    : spawnOnNode(command, options);
}

/** How a process run to its end finished, and what it wrote to its pipes. */
export interface ProcessOutput extends CommandStatus {
  /** What it wrote to stdout; empty unless stdout was `piped`. */
  stdout: Uint8Array;
  /** What it wrote to stderr; empty unless stderr was `piped`. */
  stderr: Uint8Array;
}

/** Everything `stream` carries, or nothing for a stream that was not piped. */
async function collected(
  stdio: ProcessStdio | undefined,
  stream: () => ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  if (stdio !== "piped") return new Uint8Array();
  return new Uint8Array(await new Response(stream()).arrayBuffer());
}

/**
 * Wait for `child`, which was started with `options`, reading its piped
 * output as it comes so a full pipe never stalls it.
 *
 * @throws when the child could not be started.
 */
export async function outputOf(
  child: ChildProcess,
  options: ProcessOptions,
): Promise<ProcessOutput> {
  const [status, stdout, stderr] = await Promise.all([
    child.status,
    collected(options.stdout, () => child.stdout),
    collected(options.stderr, () => child.stderr),
  ]);
  return { ...status, stdout, stderr };
}

/**
 * Run `command` with `options` to its end. Module-internal, like
 * {@link spawnProcess}: for the few commands core runs for itself.
 *
 * @throws when the command cannot be started.
 */
export async function runProcess(
  command: string,
  options: ProcessOptions,
): Promise<ProcessOutput> {
  return await outputOf(spawnProcess(command, options), options);
}

/** Call `handler` each time this process receives `signal`. */
export function addSignalListener(signal: Signal, handler: () => void): void {
  if (ON_DENO) Deno.addSignalListener(signal, handler);
  else process.on(signal, handler);
}

/** Stop calling `handler` for `signal`. */
export function removeSignalListener(
  signal: Signal,
  handler: () => void,
): void {
  if (ON_DENO) Deno.removeSignalListener(signal, handler);
  else process.off(signal, handler);
}
