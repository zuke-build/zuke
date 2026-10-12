// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one PowerShell string escaper every value written into a rendered
 * `chocolateyinstall.ps1` goes through.
 *
 * The install script runs elevated on every machine that installs the
 * package, so a value that leaves its string literal is code execution there.
 * Single-quoted strings are used throughout because nothing inside one is
 * expanded — no `$variable`, no `$(subexpression)`, no backtick escape — which
 * leaves the quote itself as the only way out.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

/**
 * Every character PowerShell accepts as a single quote: the ASCII apostrophe
 * and the typographic ones (U+2018–U+201B), which the PowerShell tokenizer
 * treats exactly like `'` — so escaping only the ASCII one would let a
 * "smart" quote close the literal.
 */
const SINGLE_QUOTES = /['\u2018\u2019\u201a\u201b]/g;

/**
 * Render `value` as a PowerShell single-quoted string literal, quotes
 * included: each single-quote character is doubled, which is how PowerShell
 * writes a literal one inside such a string.
 *
 * Nothing else needs escaping: a single-quoted string may even span lines
 * without ending. The renderer still validates every value it passes here
 * first (an id, an ASCII URL, a hex checksum), so the script reads exactly as
 * it runs.
 */
export function psString(value: string): string {
  return `'${value.replace(SINGLE_QUOTES, (quote) => quote + quote)}'`;
}
