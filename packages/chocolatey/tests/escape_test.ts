// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the two escapers every rendered value goes through: the
 * PowerShell single-quoted string and the XML element text.
 *
 * @module
 */

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { psString } from "../src/powershell.ts";
import { xmlText } from "../src/xml.ts";

Deno.test("psString: every quote PowerShell accepts is doubled", () => {
  assertEquals(psString("plain"), "'plain'");
  assertEquals(psString("it's"), "'it''s'");
  // PowerShell closes a single-quoted string on the typographic quotes too,
  // so each must be doubled like the ASCII one.
  for (const quote of ["\u2018", "\u2019", "\u201a", "\u201b"]) {
    assertEquals(
      psString(`a${quote}; calc; ${quote}`),
      `'a${quote}${quote}; calc; ${quote}${quote}'`,
    );
  }
  // Nothing expands inside single quotes, so these stay as they are.
  assertEquals(psString("$(calc) `n $env:PATH"), "'$(calc) `n $env:PATH'");
});

Deno.test("xmlText: markup characters become entities", () => {
  assertEquals(
    xmlText(`<a href="x">Tom & Jerry's</a>`, "f"),
    "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;",
  );
  assertEquals(xmlText("tab\tline\nend", "f"), "tab\tline\nend");
  assertEquals(xmlText("\u00e9\u4e2d\u{1f600}", "f"), "\u00e9\u4e2d\u{1f600}");
});

Deno.test("xmlText: a NuGet replacement token cannot form", () => {
  // choco pack replaces $name$ in the nuspec's raw text before parsing it;
  // a character reference is not a token, and parses back to "$".
  assertEquals(
    xmlText("costs $version$ or $5", "f"),
    "costs &#x24;version&#x24; or &#x24;5",
  );
});

Deno.test("xmlText: a character XML cannot hold is refused, naming the field", () => {
  assertThrows(
    () => xmlText("a\u0001b", "the nuspec <title>"),
    Error,
    "the nuspec <title> holds the character U+0001",
  );
  assertThrows(() => xmlText("\udc00", "f"), Error, "U+DC00");
  assertThrows(() => xmlText("\ufffe", "f"), Error, "U+FFFE");
});
