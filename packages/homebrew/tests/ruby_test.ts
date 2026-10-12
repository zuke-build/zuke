// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the one Ruby string escaper. Hostile input must stay a
 * single, inert string literal: no way to close the literal, interpolate, or
 * start a new line of Ruby.
 *
 * @module
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import { rubyString } from "../src/ruby.ts";

Deno.test("ruby: a plain value is quoted as it is", () => {
  assertEquals(rubyString("Build automation"), '"Build automation"');
  assertEquals(rubyString(""), '""');
  assertEquals(rubyString("naïve ✓"), '"naïve ✓"');
});

Deno.test("ruby: quotes and backslashes cannot close the literal", () => {
  assertEquals(rubyString('a"b'), '"a\\"b"');
  assertEquals(rubyString("a\\b"), '"a\\\\b"');
  // A trailing backslash would otherwise escape the closing quote.
  assertEquals(rubyString("x\\"), '"x\\\\"');
  assertEquals(rubyString('";system("x");"'), '"\\";system(\\"x\\");\\""');
});

Deno.test("ruby: every interpolation form is neutralised, a bare # is left alone", () => {
  assertEquals(rubyString('#{system("id")}'), '"\\#{system(\\"id\\")}"');
  assertEquals(rubyString("#@ivar #$global"), '"\\#@ivar \\#$global"');
  assertEquals(rubyString("issue #42 #"), '"issue #42 #"');
  // An escaped backslash before the brace must not re-enable interpolation.
  assertEquals(rubyString("\\#{x}"), '"\\\\\\#{x}"');
  assertEquals(rubyString("##{x}"), '"#\\#{x}"');
});

Deno.test("ruby: line breaks and control characters stay on one line", () => {
  assertEquals(rubyString("a\nb\r\tc"), '"a\\nb\\r\\tc"');
  assertEquals(
    rubyString("a\u0000b\u001bc\u007f"),
    '"a\\u{0}b\\u{1b}c\\u{7f}"',
  );
  assertEquals(rubyString("a\u0085b"), '"a\\u{85}b"');
  assertEquals(
    rubyString('x"\nsystem("id")\n"'),
    '"x\\"\\nsystem(\\"id\\")\\n\\""',
  );
});

Deno.test("ruby: invisible and bidirectional characters are spelled out", () => {
  assertEquals(rubyString("a\u202eb"), '"a\\u{202e}b"');
  assertEquals(
    rubyString("\u2066a\u2028b\u200bc"),
    '"\\u{2066}a\\u{2028}b\\u{200b}c"',
  );
});

Deno.test("ruby: the remaining invisible format characters are spelled out too", () => {
  // Finding 6 of the adversarial review: these render as nothing as well.
  const codes = [
    0x00ad,
    0x061c,
    0x180e,
    0x2060,
    0x2061,
    0x2062,
    0x2063,
    0x2064,
    0x206a,
    0x206b,
    0x206c,
    0x206d,
    0x206e,
    0x206f,
    0xfeff,
  ];
  for (const code of codes) {
    assertEquals(
      rubyString(`a${String.fromCodePoint(code)}b`),
      `"a\\u{${code.toString(16)}}b"`,
    );
  }
});

Deno.test("ruby: the literal is always one line with balanced, escaped quotes", () => {
  const hostile = [
    '"; `rm -rf /`; "',
    "#{`id`}",
    '\\"#{1}',
    "end\nclass Evil < Formula\n",
    "'\"\\#\n",
  ];
  for (const value of hostile) {
    const literal = rubyString(value);
    assertEquals(literal.includes("\n"), false);
    // Strip escape pairs; what remains may hold no quote but the outer two
    // and no live interpolation.
    const bare = literal.slice(1, -1).replace(/\\./g, "");
    assertEquals(bare.includes('"'), false, literal);
    assertEquals(/#[{@$]/.test(bare), false, literal);
  }
});
