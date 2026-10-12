// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one Ruby string escaper every value interpolated into a rendered formula
 * goes through.
 *
 * A formula is Ruby that Homebrew evaluates on the installing machine, so a
 * value that breaks out of its string literal is code execution on every
 * machine that installs it. One escaper, applied to every value, is what makes
 * that impossible to forget for one field: a second, slightly different copy is
 * how one of them ends up missing a case.
 *
 * @module
 */

/**
 * Formatting characters that render as nothing (or reorder what follows), so a
 * literal holding one would not read the way it parses.
 */
const INVISIBLE = new Set([
  0x00ad, // soft hyphen
  0x061c, // Arabic letter mark
  0x180e, // Mongolian vowel separator
  0x200b,
  0x200c,
  0x200d,
  0x200e,
  0x200f,
  0x2028,
  0x2029,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2060, // word joiner
  0x2061,
  0x2062,
  0x2063,
  0x2064,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
  0x206a, // deprecated format characters
  0x206b,
  0x206c,
  0x206d,
  0x206e,
  0x206f,
  0xfeff,
]);

/** The characters after a `#` that make Ruby interpolate. */
const OPENS_INTERPOLATION = new Set<string | undefined>(["{", "@", "$"]);

/** Whether `code` is a C0 or C1 control character, or DEL. */
function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * Render `value` as a Ruby double-quoted string literal, quotes included.
 *
 * Escaped: the backslash and the double quote (which would end the literal);
 * a `#` that opens an interpolation — `#{…}`, or the `#@ivar`/`#$global`
 * shorthands — as `\#`, which Ruby reads as a plain `#` (a `#` before anything
 * else cannot interpolate, and escaping it anyway is what RuboCop's
 * `Style/RedundantStringEscape`, and so `brew style`, reports); and every
 * control character (newline, tab and carriage return by name, the rest as
 * `\u{…}`), so a value always renders on one line and cannot start a new
 * statement. The invisible formatting characters — the bidirectional overrides
 * and isolates, the line and paragraph separators, the byte-order mark — are
 * written as `\u{…}` too, so the source a reviewer reads is the source Ruby
 * runs.
 */
export function rubyString(value: string): string {
  const characters = [...value];
  let out = '"';
  for (const [index, character] of characters.entries()) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\\") out += "\\\\";
    else if (character === '"') out += '\\"';
    else if (
      character === "#" && OPENS_INTERPOLATION.has(characters[index + 1])
    ) {
      out += "\\#";
    } else if (character === "\n") out += "\\n";
    else if (character === "\t") out += "\\t";
    else if (character === "\r") out += "\\r";
    else if (isControl(code) || INVISIBLE.has(code)) {
      out += `\\u{${code.toString(16)}}`;
    } else out += character;
  }
  return out + '"';
}
