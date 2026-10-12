// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one XML text escaper every value written into a rendered `.nuspec` goes
 * through.
 *
 * A nuspec is XML that choco and the community repository parse, so a value
 * that closes its element could add metadata of its own — a second `<id>`, a
 * `<dependencies>` block that pulls in another package, a `<files>` entry. One
 * escaper, applied to every value, is what makes that impossible to forget for
 * one field.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

/**
 * Characters that render as nothing or reorder what follows — Unicode format
 * characters (the bidirectional overrides and isolates, zero-width joiners,
 * the byte-order mark), the line and paragraph separators — and the C1
 * controls. XML allows them, so they are written as character references:
 * the nuspec a reviewer reads is then the nuspec that parses.
 */
const INVISIBLE = /^[\p{Cf}\p{Zl}\p{Zp}\u0080-\u009f]$/u;

/** Whether `code` is a character XML 1.0 cannot hold at all. */
function forbiddenInXml(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  return code < 0x20 || (code >= 0xd800 && code <= 0xdfff) ||
    code === 0xfffe || code === 0xffff;
}

/**
 * Escape `value` as XML element text: `&`, `<`, `>`, `"` and `'` become
 * entities, a carriage return becomes `&#xD;` (so a parser's line-ending
 * normalisation cannot change the value), and every invisible character
 * becomes a numeric reference.
 *
 * So does `$`, as `&#x24;`. `choco pack` substitutes NuGet replacement
 * tokens — `$name$` — in the nuspec's raw text before it parses the XML, so a
 * value such as `costs $5 and $10$` would otherwise be read as a token: pack
 * fails on a token with no value, and one choco does know (`$version$`, say)
 * would change the value. A character reference is not a token, and parses
 * back to the `$` it was.
 *
 * @throws {Error} naming `field` when the value holds a character XML cannot
 *   represent — a C0 control other than tab, newline and carriage return, a
 *   lone surrogate, or U+FFFE/U+FFFF.
 */
export function xmlText(value: string, field: string): string {
  let out = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (forbiddenInXml(code)) {
      throw new Error(
        `${field} holds the character U+${
          code.toString(16).toUpperCase().padStart(4, "0")
        }, which a nuspec (XML) cannot represent.`,
      );
    }
    if (character === "&") out += "&amp;";
    else if (character === "<") out += "&lt;";
    else if (character === ">") out += "&gt;";
    else if (character === '"') out += "&quot;";
    else if (character === "'") out += "&apos;";
    else if (character === "$") out += "&#x24;";
    else if (code === 0x0d || INVISIBLE.test(character)) {
      out += `&#x${code.toString(16).toUpperCase()};`;
    } else out += character;
  }
  return out;
}
