import { assertEquals, assertStringIncludes, assertThrows } from "./_assert.ts";
import { ShellArgsError, splitShellArgs } from "../src/split_args.ts";

// The vector table below mirrors `bash -c 'printf "%s\n" <input>'` for the
// quoting subset. Each row is one behaviour; the comment gives the *shell*
// source, the TS literal escapes it.

Deno.test("splitShellArgs: plain whitespace splitting", () => {
  assertEquals(splitShellArgs("a b c"), ["a", "b", "c"]); // 1
  assertEquals(splitShellArgs("  a   b  "), ["a", "b"]); // 2
  assertEquals(splitShellArgs(""), []); // 3
  assertEquals(splitShellArgs("   "), []); // 4
});

Deno.test("splitShellArgs: quoted words and adjacency", () => {
  assertEquals(splitShellArgs("'a b'"), ["a b"]); // 5
  assertEquals(splitShellArgs('"a b"'), ["a b"]); // 6
  assertEquals(splitShellArgs('a"b c"d'), ["ab cd"]); // 7
});

Deno.test("splitShellArgs: single quotes are fully literal", () => {
  // shell: 'a\b'
  assertEquals(splitShellArgs("'a\\b'"), ["a\\b"]); // 8
});

Deno.test("splitShellArgs: double-quoted backslash escapes a subset only", () => {
  // shell: "\d+" — the backslash is kept, so a regex survives the round trip.
  assertEquals(splitShellArgs('"\\d+"'), ["\\d+"]); // 9
  // shell: "a\"b"
  assertEquals(splitShellArgs('"a\\"b"'), ['a"b']); // 10
  // shell: "a\\b"
  assertEquals(splitShellArgs('"a\\\\b"'), ["a\\b"]); // 11
});

Deno.test("splitShellArgs: unquoted backslash escapes the next character", () => {
  assertEquals(splitShellArgs("a\\ b"), ["a b"]); // 12 — shell: a\ b
  assertEquals(splitShellArgs("a\\\\b"), ["a\\b"]); // 13 — shell: a\\b
});

Deno.test("splitShellArgs: empty quotes yield an empty argument", () => {
  assertEquals(splitShellArgs("''"), [""]); // 14
  assertEquals(splitShellArgs('""'), [""]); // 15
  assertEquals(splitShellArgs('a"" b'), ["a", "b"]); // 16
});

Deno.test("splitShellArgs: tabs and newlines separate; backslash-newline continues", () => {
  assertEquals(splitShellArgs("a\tb\nc"), ["a", "b", "c"]); // 17
  assertEquals(splitShellArgs('"a\\\nb"'), ["ab"]); // 18 — inside double quotes
  assertEquals(splitShellArgs("a\\\nb"), ["ab"]); // 19 — unquoted
});

Deno.test("splitShellArgs: flags, and no variable expansion", () => {
  assertEquals(splitShellArgs('--filter "x y" -x'), [ // 20
    "--filter",
    "x y",
    "-x",
  ]);
  assertEquals(splitShellArgs('"$HOME"'), ["$HOME"]); // 21 — documented non-goal
  assertEquals(splitShellArgs('"\\$HOME"'), ["$HOME"]); // 22 — shell: "\$HOME"
});

Deno.test("splitShellArgs: an unterminated quote is an error", () => {
  const dq = assertThrows(() => splitShellArgs('"abc'), ShellArgsError); // 23
  assertStringIncludes(dq.message, 'Unterminated " quote');
  assertStringIncludes(dq.message, "offset 0");
  const sq = assertThrows(() => splitShellArgs("'abc"), ShellArgsError); // 24
  assertStringIncludes(sq.message, "Unterminated ' quote");
  assertStringIncludes(sq.message, "offset 0");
});

Deno.test("splitShellArgs: error reports the offset of the opening quote", () => {
  const e = assertThrows(() => splitShellArgs("echo 'abc"), ShellArgsError);
  assertStringIncludes(e.message, "offset 5");
  assertEquals(e.name, "ShellArgsError");
});

Deno.test("splitShellArgs: a trailing backslash is a dangling continuation", () => {
  // bash drops a backslash at end of input (a line continuation with no next
  // line) and it does not start a word: `printf "<%s>" a \` prints `<a>`.
  assertEquals(splitShellArgs("a\\"), ["a"]);
  assertEquals(splitShellArgs("a \\"), ["a"]);
  assertEquals(splitShellArgs("\\"), []);
});
