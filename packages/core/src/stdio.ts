// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The process's own standard streams: where command output goes when nothing
 * has redirected it, and what the MCP stdio transport reads and writes.
 *
 * On Deno these are `Deno.stdout`, `Deno.stderr` and `Deno.stdin`, as they
 * have always been. On any other runtime they are Node's, which differ in one
 * way that matters: Node queues what is written to a pipe and returns at
 * once, and a process that exits while bytes are queued loses them. A build
 * on CI writes to a pipe. So on Node the entry point awaits
 * {@link flushOutput} before it exits.
 *
 * Internal (not a published entrypoint).
 *
 * @module
 */

import process from "node:process";
import { Readable } from "node:stream";
import type { ByteWriter, OutputSink } from "./ambient_output.ts";

/** The part of a Node output stream used here. */
export interface NodeOutput {
  /** Queue `chunk`; `done` runs once it has left the process, or failed to. */
  write(chunk: Uint8Array, done?: () => void): boolean;
}

/** Something bytes are written to, resolving once they have been. */
export interface AwaitedWriter {
  /** Write `p`, resolving to the number of bytes written. */
  write(p: Uint8Array): Promise<number>;
}

/**
 * `stream` as a writer whose write resolves once the bytes have left the
 * process. The bytes are copied: Node keeps the chunk until then, and a
 * caller may reuse its memory.
 */
export function awaitedWriter(stream: NodeOutput): AwaitedWriter {
  return {
    write: (p) =>
      new Promise((resolve) =>
        stream.write(p.slice(), () => resolve(p.length))
      ),
  };
}

/**
 * `stream` as a writer that returns at once, with the bytes queued in order
 * behind everything written before them. Copied, as in {@link awaitedWriter}.
 */
export function queuedWriter(stream: NodeOutput): ByteWriter {
  return {
    writeSync: (p) => {
      stream.write(p.slice());
      return p.length;
    },
  };
}

/** Whether this runtime is Deno, whose own streams are then the ones used. */
const ON_DENO = typeof Deno !== "undefined";

/** The process's stdout and stderr, as the sink command output is teed to. */
export function processOutput(): OutputSink {
  return ON_DENO ? { stdout: Deno.stdout, stderr: Deno.stderr } : {
    stdout: queuedWriter(process.stdout),
    stderr: queuedWriter(process.stderr),
  };
}

/**
 * Resolves once everything written to stdout and stderr so far has left the
 * process. On Deno, where a write returns only when it has, that is at once.
 */
export async function flushOutput(): Promise<void> {
  if (ON_DENO) return;
  const nothing = new Uint8Array();
  // An empty write is behind every earlier one, so it finishes after them.
  await Promise.all([
    awaitedWriter(process.stdout).write(nothing),
    awaitedWriter(process.stderr).write(nothing),
  ]);
}

/** The process's stdin, as a stream of bytes that ends when it does. */
export function stdinBytes(): ReadableStream<Uint8Array> {
  return ON_DENO ? Deno.stdin.readable : Readable.toWeb(process.stdin);
}

/** The process's stdout, as a writer whose writes can be awaited. */
export function stdoutWriter(): AwaitedWriter {
  return ON_DENO ? Deno.stdout : awaitedWriter(process.stdout);
}
