// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Per-target **summary notes**: the `key: value` pairs a target reports into
 * its own row of the end-of-build summary, so the table says what the target
 * *did* and not only that it passed:
 *
 * ```text
 * test        Succeeded    8.1s  // Tests: 837 · Passed: 837 · Failed: 0
 * ```
 *
 * A body reports through its context (`ctx.reportSummary({ … })`). Library
 * code with no context in hand — a tool wrapper that has just parsed its
 * tool's output — reports through the ambient {@link reportSummary}. Both land
 * in the same {@link TargetSummary}, which the scheduler installs for the
 * target's async subtree via {@link withAmbientSummary}. Like the ambient
 * cancellation signal it lives in an `AsyncLocalStorage`, so concurrent targets
 * never see each other's notes and nothing is left behind when a body returns.
 *
 * @module
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { stripAnsi } from "./render.ts";

/** A value a summary note may carry; a number is rendered as written. */
export type SummaryValue = string | number;

/**
 * The notes a target reports, keyed by their label — `{ Passed: 837, Failed: 0 }`.
 * Keys render in the order they are first reported.
 */
export type SummaryPairs = Readonly<Record<string, SummaryValue>>;

/** One rendered `key: value` note on a target's summary row. */
export interface SummaryEntry {
  /** The note's label, as reported (whitespace collapsed to one line). */
  readonly key: string;
  /** The note's value, rendered as text (whitespace collapsed to one line). */
  readonly value: string;
}

/**
 * Collapse a reported key or value to a single line of printable text.
 *
 * A note lands in a terminal table row and a Markdown table cell, and a wrapper
 * may hand over text a tool printed: a newline would start a new row and an
 * ANSI sequence would restyle the rest of the table, so both are removed here —
 * the one place — rather than at each renderer.
 */
function singleLine(text: string): string {
  return stripAnsi(text)
    // deno-lint-ignore no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The notes one target has reported so far: insertion-ordered by key, and
 * reporting a key again replaces its value in place.
 */
export class TargetSummary {
  readonly #entries = new Map<string, string>();

  /**
   * Record `pairs`. A key that is empty once collapsed to one line is dropped,
   * since it could not be told apart from its neighbour in the row.
   */
  add(pairs: SummaryPairs): void {
    for (const [key, value] of Object.entries(pairs)) {
      const label = singleLine(key);
      if (label === "") continue;
      this.#entries.set(label, singleLine(String(value)));
    }
  }

  /** The notes reported so far, in first-reported key order. */
  entries(): SummaryEntry[] {
    return [...this.#entries].map(([key, value]) => ({ key, value }));
  }
}

/** Per-async-context store holding the running target's collector, if any. */
const storage = new AsyncLocalStorage<TargetSummary>();

/**
 * Run `fn` with `summary` installed as the ambient collector for its entire
 * async subtree, returning `fn`'s result. Confined to this call — not visible
 * to concurrent targets, and needs no manual teardown.
 */
export function withAmbientSummary<T>(
  summary: TargetSummary,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(summary, fn);
}

/**
 * Report `key: value` notes into the **running target's** row of the
 * end-of-build summary — the ambient form of
 * {@link "./target.ts".TargetContext.reportSummary}, for code that has no
 * context in hand: a tool wrapper reporting the counts its tool printed, or a
 * helper called from a body.
 *
 * ```ts
 * reportSummary({ Tests: 837, Passed: 837, Failed: 0 });
 * ```
 *
 * Notes accumulate across calls in the same target, and reporting a key again
 * replaces its value. Outside a running target (a wrapper called from a plain
 * script, a compensation) there is no row to report into, so the call is a
 * no-op rather than an error — a wrapper never has to ask where it runs.
 */
export function reportSummary(pairs: SummaryPairs): void {
  storage.getStore()?.add(pairs);
}
