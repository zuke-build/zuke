// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { ConsoleTasks, type Sink } from "../src/console.ts";
import { logoLines, ZUKE_LOGO } from "../src/logo.ts";
import { SGR, stripAnsi } from "@zuke/core/render";
import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";

Deno.test("logoLines without colour is the raw art, line by line", () => {
  assertEquals(logoLines(false), ZUKE_LOGO.split("\n"));
});

Deno.test("logoLines with colour paints letters and shadow separately", () => {
  const lines = logoLines(true);
  assertEquals(lines.map(stripAnsi), ZUKE_LOGO.split("\n"));
  const [first] = lines;
  assertStringIncludes(first, SGR.cyan + SGR.bold);
  assertStringIncludes(first, SGR.dim);
});

Deno.test("logoLines starts a leading-shadow line with the shadow style", () => {
  // The second art line opens with box-drawing shadow, not a letter block.
  const second = logoLines(true)[1];
  assertEquals(second.startsWith(SGR.dim), true);
});

Deno.test("logoLines appends a dimmed tagline", () => {
  const plain = logoLines(false, { tagline: "v1.2.3" });
  assertEquals(plain[plain.length - 1], "v1.2.3");
  const painted = logoLines(true, { tagline: "v1.2.3" });
  assertEquals(painted[painted.length - 1], `${SGR.dim}v1.2.3${SGR.reset}`);
});

Deno.test("logoLines honours custom letter and shadow styles", () => {
  const [first] = logoLines(true, {
    letterStyle: ["magenta"],
    shadowStyle: ["gray"],
  });
  assertStringIncludes(first, SGR.magenta);
  assertStringIncludes(first, SGR.gray);
});

Deno.test("ConsoleTasks.logo prints the art through the sink", () => {
  const out: string[] = [];
  const sink: Sink = { out: (l) => out.push(l), err: () => {} };
  ConsoleTasks.configure({ sink, color: false, level: "info" });
  ConsoleTasks.logo({ tagline: "build automation" });
  assertEquals(out, [...ZUKE_LOGO.split("\n"), "build automation"]);
  ConsoleTasks.reset();
});

Deno.test("ConsoleTasks.logo is muted at level silent", () => {
  const out: string[] = [];
  const sink: Sink = { out: (l) => out.push(l), err: () => {} };
  ConsoleTasks.configure({ sink, color: false, level: "silent" });
  ConsoleTasks.logo();
  assertEquals(out, []);
  ConsoleTasks.reset();
});
