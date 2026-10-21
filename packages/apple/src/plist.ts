// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A reader for XML property lists — the format inside a `.mobileprovision`.
 * It covers the whole XML plist vocabulary (`dict`, `array`, `string`,
 * `integer`, `real`, `true`, `false`, `date`, `data`), and refuses anything
 * else rather than guessing, so a malformed profile fails with a message
 * instead of yielding a half-read value.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { decodeBase64 } from "./base64.ts";

/** A value read from a property list. */
export type PlistValue =
  | string
  | number
  | boolean
  | Date
  | Uint8Array
  | PlistValue[]
  | PlistDict;

/** A property-list dictionary. */
export interface PlistDict {
  /** The value under each key. */
  [key: string]: PlistValue;
}

/** One tag or text run of the document. */
type Token = { tag: string } | { text: string };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** `text` with its XML entity and character references decoded. */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (match, ref) => {
    if (ref.startsWith("#x")) {
      return String.fromCodePoint(parseInt(ref.slice(2), 16));
    }
    if (ref.startsWith("#")) return String.fromCodePoint(Number(ref.slice(1)));
    return ENTITIES[ref] ?? match;
  });
}

/** The document's tags and text runs, without the prolog and comments. */
function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  // One pass: the prolog, comments and the doctype are matched and skipped in
  // place, never cut out of the text, so no removal can splice a new tag
  // together from what surrounded it.
  for (
    const match of xml.matchAll(
      /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<([^>]+)>|([^<]+)/g,
    )
  ) {
    if (match[1] !== undefined) {
      // `<true />` and `<true/>` are the same tag.
      tokens.push({ tag: match[1].trim().replace(/\s+\/$/, "/") });
    } else if (match[2] !== undefined && match[2].trim() !== "") {
      tokens.push({ text: match[2] });
    }
  }
  return tokens;
}

/** Reads values off a token list, front to back. */
class Reader {
  #tokens: Token[];
  #at = 0;

  constructor(tokens: Token[]) {
    this.#tokens = tokens;
  }

  #next(): Token {
    const token = this.#tokens[this.#at++];
    if (token === undefined) throw new Error("plist: unexpected end.");
    return token;
  }

  /** The text up to the closing `</name>`, decoded ("" for none). */
  #text(name: string): string {
    const token = this.#next();
    if ("tag" in token) {
      if (token.tag === `/${name}`) return "";
      throw new Error(`plist: <${token.tag}> inside <${name}>.`);
    }
    this.#expect(`/${name}`);
    return decode(token.text);
  }

  #expect(tag: string): void {
    const token = this.#next();
    if (!("tag" in token) || token.tag !== tag) {
      throw new Error(`plist: expected <${tag}>.`);
    }
  }

  /** Whether the next token is the tag `tag`, consuming it if so. */
  #take(tag: string): boolean {
    const token = this.#tokens[this.#at];
    if (token !== undefined && "tag" in token && token.tag === tag) {
      this.#at++;
      return true;
    }
    return false;
  }

  /** The value the next element holds. */
  value(): PlistValue {
    const token = this.#next();
    if (!("tag" in token)) throw new Error("plist: text outside an element.");
    switch (token.tag) {
      case "string":
        return this.#text("string");
      case "string/":
        return "";
      case "dict/":
        return {};
      case "array/":
        return [];
      case "true/":
        return true;
      case "false/":
        return false;
      case "integer":
      case "real": {
        const text = this.#text(token.tag).trim();
        const pattern = token.tag === "integer"
          ? /^[+-]?\d+$/
          : /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
        if (!pattern.test(text)) {
          throw new Error(`plist: <${token.tag}> is not a number.`);
        }
        return Number(text);
      }
      case "date": {
        const date = new Date(this.#text("date"));
        if (Number.isNaN(date.getTime())) throw new Error("plist: bad <date>.");
        return date;
      }
      case "data": {
        const bytes = decodeBase64(this.#text("data"));
        if (bytes === undefined) {
          throw new Error("plist: <data> is not base64.");
        }
        return bytes;
      }
      case "array": {
        const items: PlistValue[] = [];
        while (!this.#take("/array")) items.push(this.value());
        return items;
      }
      case "dict": {
        const dict: PlistDict = {};
        while (!this.#take("/dict")) {
          this.#expect("key");
          const key = this.#text("key");
          if (Object.hasOwn(dict, key)) {
            throw new Error(`plist: the key ${JSON.stringify(key)} repeats.`);
          }
          dict[key] = this.value();
        }
        return dict;
      }
      default:
        throw new Error(`plist: unsupported element <${token.tag}>.`);
    }
  }

  /** The root value of a `<plist>` document. */
  document(): PlistValue {
    const open = this.#next();
    if (!("tag" in open) || !/^plist(\s|$)/.test(open.tag)) {
      throw new Error("plist: no <plist> element.");
    }
    const root = this.value();
    this.#expect("/plist");
    if (this.#at !== this.#tokens.length) {
      throw new Error("plist: content after </plist>.");
    }
    return root;
  }
}

/**
 * Parse an XML property list.
 *
 * @throws {Error} when the text is not a well-formed XML plist.
 */
export function parsePlist(xml: string): PlistValue {
  return new Reader(tokenize(xml)).document();
}
