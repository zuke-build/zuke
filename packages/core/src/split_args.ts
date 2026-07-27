/**
 * Split a command **string** into an argv array using POSIX quoting rules.
 *
 * This is the escape hatch for input that arrives as one already-written command
 * line — a `package.json` script, a Makefile recipe, a config field — which must
 * become discrete argv entries before it can be handed to
 * {@link "./shell.ts".Command}. Command *construction* inside a build should use
 * the `$` template instead, which never has to parse anything.
 *
 * @module
 */

/**
 * Raised when {@link splitShellArgs} reaches the end of the input with a quote
 * still open. Names the offending quote character and the offset at which it was
 * opened so the bad spot in a long command line is findable.
 */
export class ShellArgsError extends Error {
  /** The error name. */
  override name = "ShellArgsError";
  /** Build the error from the unclosed quote character and its offset. */
  constructor(
    /** The quote character that was never closed — `'` or `"`. */
    readonly quote: string,
    /** The zero-based index in the input at which that quote was opened. */
    readonly offset: number,
  ) {
    super(
      `Unterminated ${quote} quote in command string at offset ${offset}. ` +
        `Close the quote, or escape it with a backslash if the character was ` +
        `meant literally.`,
    );
  }
}

/** Characters that separate arguments outside quotes. */
const SEPARATORS = " \t\n\r";

/**
 * Split `input` into argv the way a POSIX shell would, honouring the **quoting
 * rules only**:
 *
 * - Unquoted runs of whitespace separate arguments; leading, trailing, and
 *   repeated whitespace produce no empty arguments.
 * - Single quotes are fully literal — no escape sequences at all, so `'a\b'`
 *   yields `a\b`.
 * - Inside double quotes a backslash escapes only `"`, `\`, `` ` ``, `$`, and a
 *   newline; before anything else it stays literal, so `"\d+"` yields `\d+`
 *   rather than silently losing the backslash.
 * - Outside quotes a backslash escapes the following character, so `a\ b` is one
 *   argument.
 * - A backslash-newline pair is a line continuation and is removed, both
 *   unquoted and inside double quotes; a backslash at the very end of the input
 *   is a dangling continuation and is dropped.
 * - Adjacent segments concatenate (`a"b c"d` → `ab cd`) and a quoted empty
 *   string is a real, empty argument (`''` → `[""]`).
 *
 * **Non-goals**, deliberately not implemented — the input is turned into argv,
 * never interpreted: no variable expansion (`"$HOME"` stays `$HOME`), no
 * globbing, no tilde expansion, no command substitution, and no operator
 * handling of any kind (`|`, `&&`, `;`, `>` are ordinary characters). A caller
 * that needs those must split on them itself, or run a real shell.
 *
 * `\r` is treated as a separator alongside space, tab, and newline so a command
 * line read from a CRLF file cannot smuggle an invisible carriage return into an
 * argument.
 *
 * @param input The command string to split.
 * @returns The argv entries, in order; an empty array for blank input.
 * @throws {ShellArgsError} If a single or double quote is never closed.
 */
export function splitShellArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let started = false;

  const flush = () => {
    if (started) {
      args.push(current);
      current = "";
      started = false;
    }
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    if (ch === "'") {
      // Fully literal: everything up to the next quote, escapes included.
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new ShellArgsError("'", i);
      current += input.slice(i + 1, end);
      started = true;
      i = end + 1;
      continue;
    }

    if (ch === '"') {
      const opened = i;
      let closed = false;
      started = true;
      i++;
      while (i < input.length) {
        const c = input[i];
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === "\\") {
          const next = input[i + 1];
          if (next === "\n") {
            i += 2; // Line continuation: both characters vanish.
            continue;
          }
          if (next === '"' || next === "\\" || next === "$" || next === "`") {
            current += next;
            i += 2;
            continue;
          }
          // Any other character: the backslash is an ordinary character, so a
          // pattern like "\d+" keeps its backslash.
          current += "\\";
          i++;
          continue;
        }
        current += c;
        i++;
      }
      if (!closed) throw new ShellArgsError('"', opened);
      continue;
    }

    if (ch === "\\") {
      const next = input[i + 1];
      if (next === undefined || next === "\n") {
        // Dangling or line continuation: nothing is contributed, and this does
        // not start a word.
        i = next === undefined ? i + 1 : i + 2;
        continue;
      }
      current += next;
      started = true;
      i += 2;
      continue;
    }

    if (SEPARATORS.includes(ch)) {
      flush();
      i++;
      continue;
    }

    current += ch;
    started = true;
    i++;
  }

  flush();
  return args;
}
