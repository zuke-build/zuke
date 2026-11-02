// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The ambient **output sink** for the live stdout/stderr of `$` commands.
 *
 * A command tees its child's output to the terminal as it arrives. When targets
 * run concurrently, the scheduler buffers each target's framework output (its
 * header, footer and errors) and flushes it as one block on completion — but a
 * child streaming straight to the terminal escaped that buffer, so a long test
 * run's output landed inside whichever other target's block happened to flush
 * around it. The scheduler therefore installs a per-target sink via
 * {@link withAmbientOutput}, and {@link "./shell.ts".Command} writes there
 * instead of to the terminal, keeping the output inside its own target's block.
 *
 * Like the ambient echo sink, it lives in an `AsyncLocalStorage`, scoped to the
 * target body's async subtree. A long-lived service started with
 * {@link "./shell.ts".Command.spawn} inherits the terminal directly and is not
 * routed through the sink. Internal (not a published entrypoint).
 *
 * @module
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Something raw output bytes can be written to, like `Deno.stdout`. */
export interface ByteWriter {
  /** Write `p`, returning the number of bytes written. */
  writeSync(p: Uint8Array): number;
}

/** Where a command's live stdout and stderr go. */
export interface OutputSink {
  /** Receives the child's stdout. */
  stdout: ByteWriter;
  /** Receives the child's stderr. */
  stderr: ByteWriter;
}

/** Per-async-context store holding the current output sink, if any. */
const storage = new AsyncLocalStorage<OutputSink>();

/** The output sink in effect, or the process's own stdout/stderr. */
export function ambientOutput(): OutputSink {
  return storage.getStore() ?? { stdout: Deno.stdout, stderr: Deno.stderr };
}

/**
 * Run `fn` with `sink` installed as the ambient output sink for its entire async
 * subtree, returning `fn`'s result.
 */
export function withAmbientOutput<T>(
  sink: OutputSink,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(sink, fn);
}
