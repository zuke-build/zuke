// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Console interception for the test suite. Anything that drives a CLI command
 * or a reporter writes to the console, so a test either asserts on what was
 * written or needs the noise gone — and either way the writers must be put back
 * afterwards, on the failure path too.
 *
 * @module
 */

import process from "node:process";
import { RuntimeTasks } from "../packages/core/mod.ts";

/**
 * Install `log`/`warn`/`error` as the console writers, returning the function
 * that restores the originals. Pass the current `console.<name>` for a channel
 * a caller wants left alone.
 */
function swap(
  log: (...args: unknown[]) => void,
  warn: (...args: unknown[]) => void,
  error: (...args: unknown[]) => void,
): () => void {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = log;
  console.warn = warn;
  console.error = error;
  return () => {
    console.log = saved.log;
    console.warn = saved.warn;
    console.error = saved.error;
  };
}

/**
 * Run a CLI command `fn`, returning its exit code alongside the lines it wrote
 * to `console.log` (`out`) and `console.error` (`err`). `console.warn` is left
 * connected, so a genuine warning still shows up in the test output.
 */
export async function capture(
  fn: () => Promise<number> | number,
): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const restore = swap(
    (...args: unknown[]) => void out.push(args.join(" ")),
    console.warn,
    (...args: unknown[]) => void err.push(args.join(" ")),
  );
  try {
    const code = await fn();
    return { code, out, err };
  } finally {
    restore();
  }
}

/**
 * Capture `console.log` and `console.warn` into one array, in the order they
 * were called — for the reporters that interleave a report with its warnings,
 * where splitting the two streams would lose which came first.
 */
export async function captureLines(
  fn: () => Promise<void>,
): Promise<string[]> {
  const lines: string[] = [];
  const push = (...args: unknown[]) => void lines.push(args.join(" "));
  const restore = swap(push, push, console.error);
  try {
    await fn();
  } finally {
    restore();
  }
  return lines;
}

/** Run `fn` with `console.log`/`console.error` discarded, restoring them after. */
export async function silence(fn: () => Promise<unknown>): Promise<void> {
  const restore = swap(() => {}, console.warn, () => {});
  try {
    await fn();
  } finally {
    restore();
  }
}

/**
 * Run `fn` with every byte the process writes to its stdout and stderr handed
 * to `push` as text instead, through whichever writer the runtime gives core:
 * Deno's `writeSync`, or a Node stream's `write`. The writers are put back
 * afterwards, on the failure path too.
 */
export async function captureStdio<T>(
  push: (text: string) => void,
  fn: () => Promise<T>,
): Promise<T> {
  const decoder = new TextDecoder();
  const text = (chunk: unknown) =>
    typeof chunk === "string"
      ? chunk
      : chunk instanceof Uint8Array
      ? decoder.decode(chunk)
      : String(chunk);
  if (RuntimeTasks.facts().name === "deno") {
    const saved = [Deno.stdout.writeSync, Deno.stderr.writeSync];
    const raw = (bytes: Uint8Array) => {
      push(text(bytes));
      return bytes.length;
    };
    Deno.stdout.writeSync = raw;
    Deno.stderr.writeSync = raw;
    try {
      return await fn();
    } finally {
      [Deno.stdout.writeSync, Deno.stderr.writeSync] = saved;
    }
  }
  const streams = [process.stdout, process.stderr];
  const saved = streams.map((stream) => Reflect.get(stream, "write"));
  for (const stream of streams) {
    Reflect.set(stream, "write", (chunk: unknown) => {
      push(text(chunk));
      return true;
    });
  }
  try {
    return await fn();
  } finally {
    streams.forEach((stream, i) => Reflect.set(stream, "write", saved[i]));
  }
}
