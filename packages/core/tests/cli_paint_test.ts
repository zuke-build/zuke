// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { cliPaint, PLAIN_PAINT } from "../src/cli_paint.ts";
import { formatVersionPanel, versionFacts } from "../src/cli_version.ts";
import { stripAnsi } from "../src/render.ts";
import { VERSION } from "../src/version.ts";

const FACTS = {
  core: "1.2.3",
  deno: "2.8.3",
  typescript: "5.9.2",
  platform: "linux-x86_64",
};

Deno.test("plain paint is the identity, whatever it is handed", () => {
  for (const paint of [PLAIN_PAINT, cliPaint({ rich: false, color: true })]) {
    assertEquals(paint, PLAIN_PAINT);
    for (
      const fn of [
        paint.heading,
        paint.command,
        paint.flag,
        paint.target,
        paint.muted,
        paint.brand,
      ]
    ) {
      assertEquals(fn("Text: [x]"), "Text: [x]");
    }
  }
});

Deno.test("rich paint colours each kind and glyphs only the headings", () => {
  const paint = cliPaint({ rich: true, color: true });
  assertEquals(paint.rich, true);
  assertEquals(stripAnsi(paint.heading("Targets:")), "◆ Targets:");
  for (
    const fn of [
      paint.command,
      paint.flag,
      paint.target,
      paint.muted,
      paint.brand,
    ]
  ) {
    const painted = fn("name");
    assertEquals(painted === "name", false);
    assertEquals(stripAnsi(painted), "name");
  }
});

Deno.test("rich paint without colour keeps the glyph and emits no escapes", () => {
  const paint = cliPaint({ rich: true, color: false });
  assertEquals(paint.heading("Targets:"), "◆ Targets:");
  assertEquals(paint.target("name"), "name");
});

Deno.test("the version panel boxes each fact under a zuke title", () => {
  const text = formatVersionPanel(
    FACTS,
    cliPaint({ rich: true, color: false }),
  );
  const lines = text.split("\n");
  assertEquals(lines.length, 6);
  assertStringIncludes(lines[0], " zuke ");
  assertEquals(lines[0].startsWith("┌"), true);
  assertEquals(lines[5].startsWith("└"), true);
  assertStringIncludes(lines[1], "◆ core        1.2.3");
  assertStringIncludes(lines[2], "◆ deno        2.8.3");
  assertStringIncludes(lines[3], "◆ typescript  5.9.2");
  assertStringIncludes(lines[4], "◆ platform    linux-x86_64");
  // Every row is flush with the border.
  const widths = new Set(lines.map((l) => l.length));
  assertEquals(widths.size, 1);
});

Deno.test("the coloured version panel has the same visible text", () => {
  const plainText = formatVersionPanel(
    FACTS,
    cliPaint({ rich: true, color: false }),
  );
  const coloured = formatVersionPanel(
    FACTS,
    cliPaint({ rich: true, color: true }),
  );
  assertEquals(coloured === plainText, false);
  assertEquals(stripAnsi(coloured), plainText);
});

Deno.test("versionFacts reports the running process", () => {
  const facts = versionFacts();
  assertEquals(facts.core, VERSION);
  assertEquals(facts.deno, Deno.version.deno);
  assertEquals(facts.typescript, Deno.version.typescript);
  assertEquals(facts.platform, `${Deno.build.os}-${Deno.build.arch}`);
});
