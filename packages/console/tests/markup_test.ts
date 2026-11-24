// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../core/tests/_testing.ts";
import { escapeMarkup, renderMarkup } from "../src/markup.ts";
import { SGR } from "@zuke/core/render";
import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";

test("renderMarkup strips tags when colour is off", () => {
  assertEquals(renderMarkup("[red]hi[/]", { color: false }), "hi");
  assertEquals(renderMarkup("plain text", { color: false }), "plain text");
});

test("renderMarkup paints a single tag", () => {
  assertEquals(
    renderMarkup("[red]hi[/]", { color: true }),
    `${SGR.red}hi${SGR.reset}`,
  );
});

test("renderMarkup combines space-separated styles", () => {
  assertEquals(
    renderMarkup("[red bold]hi[/]", { color: true }),
    `${SGR.red}${SGR.bold}hi${SGR.reset}`,
  );
});

test("renderMarkup nests and restores the surrounding style", () => {
  const out = renderMarkup("[red]a[bold]b[/]c[/]", { color: true });
  assertEquals(
    out,
    `${SGR.red}a${SGR.bold}b${SGR.reset}${SGR.red}c${SGR.reset}`,
  );
});

test("renderMarkup resolves theme tags, then raw styles", () => {
  const out = renderMarkup("[ok]done[/]", {
    color: true,
    tags: { ok: ["green"] },
  });
  assertEquals(out, `${SGR.green}done${SGR.reset}`);
});

test("renderMarkup treats unknown tags as no-ops but still nests", () => {
  assertEquals(renderMarkup("[wat]x[/]", { color: true }), `x${SGR.reset}`);
  assertEquals(renderMarkup("[wat]x[/]", { color: false }), "x");
});

test("renderMarkup unescapes doubled brackets", () => {
  assertEquals(renderMarkup("[[red]]", { color: true }), "[red]");
  assertEquals(renderMarkup("a ]] b", { color: false }), "a ] b");
});

test("renderMarkup leaves a stray unmatched bracket verbatim", () => {
  assertEquals(renderMarkup("a [ b", { color: false }), "a [ b");
  assertEquals(renderMarkup("a ] b", { color: false }), "a ] b");
});

test("renderMarkup closes an unbalanced tag at the end", () => {
  assertStringIncludes(renderMarkup("[red]hi", { color: true }), SGR.reset);
  // A stray close with nothing open is ignored.
  assertEquals(renderMarkup("hi[/]", { color: true }), "hi");
});

test("escapeMarkup doubles brackets so they survive rendering", () => {
  assertEquals(escapeMarkup("a [b] c"), "a [[b]] c");
  assertEquals(escapeMarkup("no brackets"), "no brackets");
  // Round-trip: escaped text renders back to its literal self, tags inert.
  const raw = "path[0] = [red]";
  assertEquals(renderMarkup(escapeMarkup(raw), { color: true }), raw);
  assertEquals(renderMarkup(escapeMarkup(raw), { color: false }), raw);
});
