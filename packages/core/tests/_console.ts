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
