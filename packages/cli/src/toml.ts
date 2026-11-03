// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A strict reader for the subset of TOML that `zuke import` needs from a
 * `pyproject.toml`, so the package stays dependency-free.
 *
 * Read: comments; `[table]` headers with bare, quoted and dotted keys
 * (`[tool.hatch.envs."default".scripts]`); key/value pairs with bare, quoted
 * and dotted keys; basic and literal strings, single- and multi-line
 * (`"""`/`'''`, with the basic form's escapes and line-ending backslash);
 * decimal integers and floats; booleans; arrays (multi-line, comments inside,
 * trailing comma); and inline tables (newlines and a trailing comma tolerated,
 * as TOML 1.1 allows).
 *
 * `[[array.of.tables]]` headers are parsed and their contents validated, but
 * discarded: no task table is an array of tables, and skipping them keeps
 * every `pyproject.toml` that carries a `[[tool.mypy.overrides]]` readable.
 *
 * Rejected, naming the line: dates and times, hexadecimal/octal/binary
 * integers, `inf`/`nan`, a duplicate key, a table defined twice, a control
 * character in a string, and anything else malformed.
 *
 * @module
 */

/** A parsed TOML table: plain data, to be narrowed by the caller. */
type Table = Record<string, unknown>;

/** Bare key characters. */
const BARE_KEY = /[A-Za-z0-9_-]+/y;

/** A decimal integer or float, underscores between digits allowed. */
const NUMBER =
  /[+-]?(?:0|[1-9](?:_?[0-9])*)(?:\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?/y;

/** The single-character escapes of a basic string. */
const ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

/**
 * Parse `text` as TOML into plain data: tables are objects, arrays are arrays,
 * strings, numbers and booleans are themselves.
 *
 * @throws {SyntaxError} naming the line of the first construct it cannot read.
 */
export function parseToml(text: string): Table {
  return new Reader(text).document();
}

/** Read a value at `key` only when it is the table's own (never a prototype's). */
function own(table: Table, key: string): unknown {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Whether `value` is a parsed table. */
function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The cursor over one document. */
class Reader {
  private pos = 0;
  /** Tables a `[header]` has defined, so a second definition is refused. */
  private readonly defined = new Set<Table>();

  constructor(private readonly text: string) {}

  document(): Table {
    const root: Table = {};
    let current = root;
    for (;;) {
      this.skipBlank();
      if (this.pos >= this.text.length) return root;
      if (this.text.startsWith("[[", this.pos)) {
        this.pos += 2;
        this.keyPath();
        this.expect("]]");
        current = {}; // validated, then discarded (see the module doc)
      } else if (this.text[this.pos] === "[") {
        this.pos++;
        const path = this.keyPath();
        this.expect("]");
        current = this.header(root, path);
      } else {
        this.keyValue(current);
      }
      this.endOfLine();
    }
  }

  /** The table a `[a.b.c]` header names, created on first use. */
  private header(root: Table, path: readonly string[]): Table {
    const table = this.descend(root, path);
    if (this.defined.has(table)) {
      this.fail(`table [${path.join(".")}] is defined twice`);
    }
    this.defined.add(table);
    return table;
  }

  /** Walk (and create) the tables along `path` from `from`. */
  private descend(from: Table, path: readonly string[]): Table {
    let table = from;
    for (const key of path) {
      const next = own(table, key);
      if (next === undefined) {
        const created: Table = {};
        define(table, key, created);
        table = created;
      } else if (isTable(next)) {
        table = next;
      } else {
        this.fail(`key "${key}" is already a value, not a table`);
      }
    }
    return table;
  }

  /** `key = value`, assigned into `table` (a dotted key into its nested tables). */
  private keyValue(table: Table): void {
    const path = this.keyPath();
    this.expect("=");
    this.skipSpaces();
    const value = this.value();
    const last = path[path.length - 1];
    const target = this.descend(table, path.slice(0, -1));
    if (Object.hasOwn(target, last)) this.fail(`duplicate key "${last}"`);
    define(target, last, value);
  }

  /** One or more keys joined by dots, with spaces around each. */
  private keyPath(): string[] {
    const path = [this.key()];
    for (;;) {
      this.skipSpaces();
      if (this.text[this.pos] !== ".") return path;
      this.pos++;
      path.push(this.key());
    }
  }

  private key(): string {
    this.skipSpaces();
    const ch = this.text[this.pos];
    if (ch === '"') return this.basicString();
    if (ch === "'") return this.literalString();
    BARE_KEY.lastIndex = this.pos;
    const bare = BARE_KEY.exec(this.text);
    if (bare === null) this.fail("expected a key");
    this.pos += bare[0].length;
    return bare[0];
  }

  private value(): unknown {
    const rest = this.text.slice(this.pos, this.pos + 3);
    if (rest === '"""') return this.multilineString('"');
    if (rest === "'''") return this.multilineString("'");
    const ch = this.text[this.pos];
    if (ch === '"') return this.basicString();
    if (ch === "'") return this.literalString();
    if (ch === "[") return this.array();
    if (ch === "{") return this.inlineTable();
    for (const word of ["true", "false"]) {
      if (this.text.startsWith(word, this.pos) && this.delimited(word.length)) {
        this.pos += word.length;
        return word === "true";
      }
    }
    NUMBER.lastIndex = this.pos;
    const number = NUMBER.exec(this.text);
    if (number !== null && this.delimited(number[0].length)) {
      this.pos += number[0].length;
      return Number(number[0].replaceAll("_", ""));
    }
    this.fail(
      "expected a value (a string, number, boolean, array or inline table; " +
        "dates and hex/octal/binary numbers are not read)",
    );
  }

  /** Whether the `length` characters at the cursor end a value. */
  private delimited(length: number): boolean {
    const next = this.text[this.pos + length];
    return next === undefined || /[\s,\]}#]/.test(next);
  }

  private basicString(): string {
    this.pos++;
    let out = "";
    for (;;) {
      const ch = this.text[this.pos];
      if (ch === undefined || ch === "\n") this.fail("unterminated string");
      this.pos++;
      if (ch === '"') return out;
      out += ch === "\\" ? this.escape() : this.plain(ch);
    }
  }

  private literalString(): string {
    this.pos++;
    const end = this.text.indexOf("'", this.pos);
    const newline = this.text.indexOf("\n", this.pos);
    if (end === -1 || (newline !== -1 && newline < end)) {
      this.fail("unterminated string");
    }
    const body = this.text.slice(this.pos, end);
    for (const ch of body) this.plain(ch);
    this.pos = end + 1;
    return body;
  }

  /** A `"""` or `'''` string, `quote` naming which. */
  private multilineString(quote: string): string {
    this.pos += 3;
    // A newline straight after the opening delimiter is trimmed.
    if (this.text.startsWith("\r\n", this.pos)) this.pos += 2;
    else if (this.text[this.pos] === "\n") this.pos++;
    let out = "";
    for (;;) {
      const ch = this.text[this.pos];
      if (ch === undefined) this.fail("unterminated multi-line string");
      if (ch === quote && this.text.startsWith(quote.repeat(3), this.pos)) {
        // Up to two quotes may sit right before the closing delimiter.
        let run = 3;
        while (this.text[this.pos + run] === quote) run++;
        if (run > 5) this.fail("too many quotes closing a multi-line string");
        this.pos += run;
        return out + quote.repeat(run - 3);
      }
      this.pos++;
      if (ch === "\\" && quote === '"') {
        const continuation = /[ \t]*\r?\n[\s]*/y;
        continuation.lastIndex = this.pos;
        const skip = continuation.exec(this.text);
        if (skip !== null) this.pos += skip[0].length;
        else out += this.escape();
      } else {
        out += ch === "\n" || ch === "\r" ? ch : this.plain(ch);
      }
    }
  }

  /** The character a `\` escape (cursor just past the backslash) stands for. */
  private escape(): string {
    const ch = this.text[this.pos];
    if (ch !== undefined && Object.hasOwn(ESCAPES, ch)) {
      this.pos++;
      return ESCAPES[ch];
    }
    const width = ch === "u" ? 4 : ch === "U" ? 8 : 0;
    const hex = this.text.slice(this.pos + 1, this.pos + 1 + width);
    const code = width > 0 && /^[0-9A-Fa-f]+$/.test(hex) && hex.length === width
      ? parseInt(hex, 16)
      : -1;
    if (code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      this.fail("invalid escape sequence in string");
    }
    this.pos += 1 + width;
    return String.fromCodePoint(code);
  }

  /** `ch` unchanged, unless it is a control character TOML forbids in a string. */
  private plain(ch: string): string {
    // deno-lint-ignore no-control-regex -- matching control characters is the point
    if (/[\x00-\x08\x0a-\x1f\x7f]/.test(ch)) {
      this.fail("control character in string");
    }
    return ch;
  }

  private array(): unknown[] {
    this.pos++;
    const items: unknown[] = [];
    for (;;) {
      this.skipBlank();
      if (this.text[this.pos] === "]") {
        this.pos++;
        return items;
      }
      items.push(this.value());
      this.skipBlank();
      const ch = this.text[this.pos];
      this.pos++;
      if (ch === "]") return items;
      if (ch !== ",") this.fail('expected "," or "]" in array');
    }
  }

  private inlineTable(): Table {
    this.pos++;
    const table: Table = {};
    for (;;) {
      this.skipBlank();
      if (this.text[this.pos] === "}") {
        this.pos++;
        return table;
      }
      this.keyValue(table);
      this.skipBlank();
      const ch = this.text[this.pos];
      this.pos++;
      if (ch === "}") return table;
      if (ch !== ",") this.fail('expected "," or "}" in inline table');
    }
  }

  /** Expect the literal `token` (after optional spaces). */
  private expect(token: string): void {
    this.skipSpaces();
    if (!this.text.startsWith(token, this.pos)) {
      this.fail(`expected "${token}"`);
    }
    this.pos += token.length;
  }

  /** Only a comment may follow a statement on its line. */
  private endOfLine(): void {
    this.skipSpaces();
    if (this.text[this.pos] === "#") this.skipComment();
    if (this.text.startsWith("\r\n", this.pos)) this.pos += 2;
    else if (this.text[this.pos] === "\n") this.pos++;
    else if (this.pos < this.text.length) this.fail("expected a new line");
  }

  private skipSpaces(): void {
    while (this.text[this.pos] === " " || this.text[this.pos] === "\t") {
      this.pos++;
    }
  }

  /** Spaces, newlines and comments. */
  private skipBlank(): void {
    for (;;) {
      const ch = this.text[this.pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") this.pos++;
      else if (ch === "#") this.skipComment();
      else return;
    }
  }

  private skipComment(): void {
    const end = this.text.indexOf("\n", this.pos);
    this.pos = end === -1 ? this.text.length : end;
  }

  private fail(message: string): never {
    const line = this.text.slice(0, this.pos).split("\n").length;
    throw new SyntaxError(`line ${line}: ${message}`);
  }
}

/**
 * Set `table[key]` as an own, enumerable property. `define` rather than
 * assignment, so a key named `__proto__` is stored as data instead of
 * replacing the object's prototype.
 */
function define(table: Table, key: string, value: unknown): void {
  Object.defineProperty(table, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
