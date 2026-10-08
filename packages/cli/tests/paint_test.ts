// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import { stripAnsi } from "@zuke/core/render";
import { cliPaint, invocationPaint, PLAIN_PAINT } from "../src/paint.ts";
import * as core from "@zuke/core/render";
import { withEnv } from "../../core/tests/_env.ts";

const KINDS = [
  "heading",
  "command",
  "flag",
  "target",
  "muted",
  "brand",
  "ok",
  "fail",
] as const;

Deno.test("plain paint is the identity, and keeps the banner unless plain was asked for", () => {
  for (const kind of KINDS) assertEquals(PLAIN_PAINT[kind]("text"), "text");
  assertEquals(PLAIN_PAINT.banner, true);
  // A pipe or CI: not rich, banner kept.
  const piped = cliPaint({ rich: false, color: false, banner: true });
  assertEquals(piped.rich, false);
  assertEquals(piped.banner, true);
  assertEquals(piped.ok("Done"), "Done");
  // Asked for plain: not rich, and no banner either.
  assertEquals(
    cliPaint({ rich: false, color: false, banner: false }).banner,
    false,
  );
});

Deno.test("rich paint adds glyphs and colour, never words", () => {
  const paint = cliPaint({ rich: true, color: true, banner: true });
  assertEquals(stripAnsi(paint.heading("Usage:")), "◆ Usage:");
  assertEquals(stripAnsi(paint.ok("Done")), "✔ Done");
  assertEquals(stripAnsi(paint.fail("Nope")), "✖ Nope");
  for (const kind of ["command", "muted", "target"] as const) {
    const painted = paint[kind]("x");
    assertEquals(painted === "x", false, kind);
    assertEquals(stripAnsi(painted), "x", kind);
  }
});

Deno.test("rich paint under NO_COLOR keeps the glyphs and emits no escapes", () => {
  const paint = cliPaint({ rich: true, color: false, banner: true });
  assertEquals(paint.ok("Done"), "✔ Done");
  assertEquals(paint.command("x"), "x");
});

Deno.test("invocationPaint reads --plain, ZUKE_PLAIN and the terminal through core", async () => {
  await withEnv(
    { ZUKE_PLAIN: undefined, CI: undefined, GITHUB_ACTIONS: undefined },
    () => {
      assertEquals(invocationPaint(undefined, () => true).rich, true);
      assertEquals(invocationPaint(undefined, () => false).rich, false);
      const plain = invocationPaint(true, () => true);
      assertEquals([plain.rich, plain.banner], [false, false]);
    },
  );
  await withEnv({ ZUKE_PLAIN: "1" }, () => {
    assertEquals(invocationPaint(undefined, () => true).rich, false);
  });
});

Deno.test("the palette is core's, with the banner beside it", () => {
  const mode = { rich: true, color: true, banner: false };
  const mine = cliPaint(mode);
  const theirs = core.cliPaint(mode);
  for (const kind of KINDS) assertEquals(mine[kind]("x"), theirs[kind]("x"));
  assertEquals(mine.banner, false);
});
