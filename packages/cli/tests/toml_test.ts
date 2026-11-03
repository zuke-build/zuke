// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { parseToml } from "../src/toml.ts";

Deno.test("parseToml reads tables, dotted and quoted keys, and comments", () => {
  const doc = parseToml([
    "# a comment",
    "top = 1 # trailing comment",
    "",
    "[tool.poe.tasks]",
    "lint = 'ruff check .'",
    'ci.sequence = ["lint"]',
    "",
    '[tool.hatch.envs."default".scripts]',
    '"a b" = "x"',
    "[ spaced . key ]",
    "k = true",
    "\r",
  ].join("\n"));
  assertEquals(doc, {
    top: 1,
    tool: {
      poe: { tasks: { lint: "ruff check .", ci: { sequence: ["lint"] } } },
      hatch: { envs: { default: { scripts: { "a b": "x" } } } },
    },
    spaced: { key: { k: true } },
  });
});

Deno.test("parseToml reads every scalar form it supports", () => {
  const doc = parseToml([
    "a = 42",
    "b = -1_000",
    "c = 3.5e2",
    "d = +0.25",
    "e = false",
    'f = "tab\\there \\"q\\" \\\\ \\u00e9 \\U0001F600"',
    "g = 'C:\\path'",
    "h = 0",
  ].join("\n"));
  assertEquals(doc, {
    a: 42,
    b: -1000,
    c: 350,
    d: 0.25,
    e: false,
    f: 'tab\there "q" \\ é 😀',
    g: "C:\\path",
    h: 0,
  });
});

Deno.test("parseToml reads multi-line strings", () => {
  const doc = parseToml([
    'a = """',
    "one",
    'two "quoted" """',
    'b = """trim \\',
    '    joined"""""',
    "c = '''",
    "raw \\n kept'''",
    "d = '''x'''''",
    'e = """\r\nline"""',
  ].join("\n"));
  assertEquals(doc.a, 'one\ntwo "quoted" ');
  assertEquals(doc.b, 'trim joined""');
  assertEquals(doc.c, "raw \\n kept");
  assertEquals(doc.d, "x''");
  assertEquals(doc.e, "line");
});

Deno.test("parseToml reads multi-line arrays and inline tables", () => {
  const doc = parseToml([
    "a = [",
    "  1, # one",
    "  [2, 3],",
    "  { cmd = 'x', help = \"y\" },",
    "]",
    "b = []",
    "c = { }",
    "d = { x.y = 1, z = [ ], }",
  ].join("\n"));
  assertEquals(doc, {
    a: [1, [2, 3], { cmd: "x", help: "y" }],
    b: [],
    c: {},
    d: { x: { y: 1 }, z: [] },
  });
});

Deno.test("parseToml validates and discards arrays of tables", () => {
  const doc = parseToml([
    "[[tool.mypy.overrides]]",
    'module = "a"',
    "[tool.poe.tasks]",
    'x = "y"',
    "[[tool.mypy.overrides]]",
    'module = "b"',
  ].join("\n"));
  assertEquals(doc, { tool: { poe: { tasks: { x: "y" } } } });
  assertThrows(() => parseToml("[[a]]\nb = \n"), SyntaxError, "line 2:");
});

Deno.test("parseToml reads a CRLF document", () => {
  // A pyproject.toml saved on Windows: a stray \r must not read as a
  // control character in a value, or as junk after a statement.
  const doc = parseToml(
    '[tool.poe.tasks]\r\nlint = "ruff" # c\r\nci = [\r\n  "lint",\r\n]\r\nm = """\r\na\r\n"""\r\n',
  );
  assertEquals(doc, {
    tool: { poe: { tasks: { lint: "ruff", ci: ["lint"], m: "a\r\n" } } },
  });
});

Deno.test("parseToml stores a __proto__ key as data", () => {
  const doc = parseToml('__proto__ = "x"\n[a."__proto__"]\nb = 1\n');
  assertEquals(Object.keys(doc), ["__proto__", "a"]);
  assertEquals(Object.getPrototypeOf(doc), Object.prototype);
  assertEquals(Object.hasOwn(doc, "__proto__"), true);
  assertEquals("b" in {}, false); // Object.prototype untouched
});

Deno.test("parseToml names the line of what it cannot read", () => {
  const cases: [string, string][] = [
    ["a = 1\na = 2", 'line 2: duplicate key "a"'],
    ["[a]\n[a]", "line 2: table [a] is defined twice"],
    ["a = 1\n[a.b]", 'line 2: key "a" is already a value'],
    ["a = 1\na.b = 2", 'line 2: key "a" is already a value'],
    ["x = 1979-05-27", "line 1: expected a value"],
    ["x = 0x1F", "line 1: expected a value"],
    ["x = inf", "line 1: expected a value"],
    ["x = 01", "line 1: expected a value"],
    ["x = true1", "line 1: expected a value"],
    ["x =", "line 1: expected a value"],
    ['x = "open', "line 1: unterminated string"],
    ['x = "open\n"', "line 1: unterminated string"],
    ["x = 'open", "line 1: unterminated string"],
    ["x = 'open\n'", "line 1: unterminated string"],
    ['x = """open', "line 1: unterminated multi-line string"],
    ['x = """a""""""', "line 1: too many quotes"],
    ['x = "\\q"', "line 1: invalid escape"],
    ['x = "\\u12"', "line 1: invalid escape"],
    ['x = "\\uD800"', "line 1: invalid escape"],
    ['x = "\\U00110000"', "line 1: invalid escape"],
    ['x = "a\u0001"', "line 1: control character"],
    ["x = 'a\u007f'", "line 1: control character"],
    ['x = """a\u0000"""', "line 1: control character"],
    ["x = [1 2]", 'line 1: expected "," or "]"'],
    ["x = [1,", "line 1: expected a value"],
    ["x = {a = 1 b = 2}", 'line 1: expected "," or "}"'],
    ["x = 1 y = 2", "line 1: expected a new line"],
    ["= 1", "line 1: expected a key"],
    ["x 1", 'line 1: expected "="'],
    ["[a", 'line 1: expected "]"'],
    ["\n\n[[a]", 'line 3: expected "]]"'],
  ];
  for (const [text, message] of cases) {
    assertThrows(() => parseToml(text), SyntaxError, message);
  }
});
