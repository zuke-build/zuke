/**
 * A small Spectre.Console-style markup language: `[red bold]text[/]`. Styling
 * lives inside the string as data — so the public API stays task-shaped and
 * declarative, with no chalk-style chainable style objects to pass around —
 * and every `ConsoleTasks` method renders its input through {@link renderMarkup}.
 *
 * Tags carry one or more space-separated style names (`[yellow underline]`);
 * `[/]` closes the most recent tag, restoring the surrounding styles. Unknown
 * tags contribute no colour but still nest correctly. A literal bracket is
 * written by doubling it: `[[` → `[` and `]]` → `]`.
 *
 * @module
 */

import { isStyleName, SGR, sgrCodes, type StyleName } from "@zuke/core/render";

/** Options for {@link renderMarkup}. */
export interface MarkupOptions {
  /** Emit ANSI colour codes; when false, tags are stripped to plain text. */
  color: boolean;
  /** Extra tag names (e.g. theme tokens) mapped to concrete styles. */
  tags?: Record<string, StyleName[]>;
}

/** Resolve a tag name to its escape codes via theme tags, then raw styles. */
function codesFor(name: string, tags?: Record<string, StyleName[]>): string {
  const mapped = tags?.[name];
  if (mapped !== undefined) return sgrCodes(mapped);
  return isStyleName(name) ? SGR[name] : "";
}

/**
 * Render markup to a terminal string. With `color: false` the same parser runs
 * but emits no escape codes, so it doubles as a "strip markup" pass for CI and
 * GitHub Actions annotations.
 */
export function renderMarkup(input: string, options: MarkupOptions): string {
  const { color, tags } = options;
  let out = "";
  const stack: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "[") {
      if (input[i + 1] === "[") {
        out += "[";
        i += 2;
        continue;
      }
      const end = input.indexOf("]", i + 1);
      if (end === -1) {
        out += ch;
        i += 1;
        continue;
      }
      const tag = input.slice(i + 1, end);
      i = end + 1;
      if (tag === "/") {
        if (stack.length > 0) {
          stack.pop();
          if (color) out += SGR.reset + stack.join("");
        }
        continue;
      }
      let codes = "";
      for (const name of tag.split(/\s+/).filter(Boolean)) {
        codes += codesFor(name, tags);
      }
      stack.push(codes);
      if (color) out += codes;
      continue;
    }
    if (ch === "]" && input[i + 1] === "]") {
      out += "]";
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  if (color && stack.length > 0) out += SGR.reset;
  return out;
}
