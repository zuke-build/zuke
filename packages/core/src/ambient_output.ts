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
 * Two other paths print from a target body and are routed the same way: the
 * console (`console.log` and friends, which `@zuke/console` writes through), and
 * a long-lived service started with {@link "./shell.ts".Command.spawn}, whose
 * output is piped into the sink instead of inheriting the terminal. Once the
 * target's block is flushed the sink passes writes straight through, so a
 * service that outlives its target keeps printing live.
 *
 * Like the ambient echo sink, it lives in an `AsyncLocalStorage`, scoped to the
 * target body's async subtree. Internal (not a published entrypoint).
 *
 * @module
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { format } from "node:util";

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
  return scopedOutput() ?? { stdout: Deno.stdout, stderr: Deno.stderr };
}

/** The sink installed by {@link withAmbientOutput}, or `undefined` outside one. */
export function scopedOutput(): OutputSink | undefined {
  return storage.getStore();
}

/**
 * Run `fn` with `sink` installed as the ambient output sink for its entire async
 * subtree, returning `fn`'s result.
 */
export function withAmbientOutput<T>(
  sink: OutputSink,
  fn: () => Promise<T>,
): Promise<T> {
  routeConsole();
  return storage.run(sink, fn);
}

/** Write every byte of `bytes`; `writeSync` may write fewer than asked. */
export function writeAll(to: ByteWriter, bytes: Uint8Array): void {
  let written = 0;
  while (written < bytes.length) {
    written += to.writeSync(bytes.subarray(written));
  }
}

/** The console methods routed into the sink, and the stream each one uses. */
const CONSOLE_ROUTES = [
  ["log", "stdout"],
  ["info", "stdout"],
  ["debug", "stdout"],
  ["warn", "stderr"],
  ["error", "stderr"],
] as const;

/** The wrappers {@link routeConsole} installed, so it never wraps one twice. */
const routed = new WeakSet<(...data: unknown[]) => void>();

const encoder = new TextEncoder();

/**
 * Wrap the console methods so a call made inside {@link withAmbientOutput} goes
 * to the sink, formatted as the console would format it, and a call outside one
 * goes to the method that was there before.
 *
 * It re-checks on every call rather than patching once: a test, or an embedder,
 * may replace `console.log` after the first wrap, and that replacement must be
 * wrapped in turn rather than left to bypass the sink.
 */
function routeConsole(): void {
  // shortcut: the line-oriented methods only; `console.table`, `dir`, `group`
  // and `trace` still print directly. Route them too if a build relies on one.
  for (const [method, stream] of CONSOLE_ROUTES) {
    const previous = console[method];
    if (routed.has(previous)) continue;
    const wrapper = (...data: unknown[]): void => {
      const sink = storage.getStore();
      if (sink === undefined) return previous(...data);
      writeAll(sink[stream], encoder.encode(format(...data) + "\n"));
    };
    routed.add(wrapper);
    console[method] = wrapper;
  }
}
