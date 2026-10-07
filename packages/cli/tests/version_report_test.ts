// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { stripAnsi } from "@zuke/core/render";
import {
  formatVersionPanel,
  homeRelative,
  lockedCoreVersions,
} from "../src/version_report.ts";
import { cliPaint } from "../src/paint.ts";

Deno.test("lockedCoreVersions reads the core a lock resolves, once per version", () => {
  const lock = JSON.stringify({
    version: "5",
    specifiers: {
      "jsr:@zuke/core@^1.31.0": "1.42.0",
      "jsr:@zuke/core@^1.40.0": "1.42.0",
      "jsr:@zuke/deno@^1": "1.3.0",
      "jsr:@zuke/core-extra@^1": "9.9.9",
    },
  });
  assertEquals(lockedCoreVersions(lock), ["1.42.0"]);
  const split = JSON.stringify({
    specifiers: {
      "jsr:@zuke/core@^0.9": "0.9.4",
      "jsr:@zuke/core@^1": "1.66.0",
    },
  });
  assertEquals(lockedCoreVersions(split), ["0.9.4", "1.66.0"]);
});

Deno.test("lockedCoreVersions is empty for a lock without core, or not a lock", () => {
  assertEquals(
    lockedCoreVersions(JSON.stringify({ specifiers: { "npm:x@1": "1.0.0" } })),
    [],
  );
  assertEquals(lockedCoreVersions("not json"), []);
});

Deno.test("homeRelative writes home as ~, and only a whole leading directory", () => {
  assertEquals(homeRelative("/home/me/work/app", "/home/me"), "~/work/app");
  assertEquals(homeRelative("/home/me/work/app", "/home/me/"), "~/work/app");
  assertEquals(homeRelative("/home/me", "/home/me"), "~");
  assertEquals(homeRelative("/home/me2/app", "/home/me"), "/home/me2/app");
  assertEquals(homeRelative("/srv/app", undefined), "/srv/app");
  assertEquals(homeRelative("/srv/app", ""), "/srv/app");
  assertEquals(homeRelative("/srv/app", "/"), "/srv/app");
});

Deno.test("the version panel boxes each row under a zuke title, flush", () => {
  const rows = [["cli", "1.10.0"], ["core", "1.42.0"], [
    "deno",
    "2.8.3",
  ]] as const;
  const plainText = formatVersionPanel(
    rows,
    cliPaint({ rich: true, color: false, banner: true }),
  );
  const lines = plainText.split("\n");
  assertEquals(lines.length, 5);
  assertStringIncludes(lines[0], " zuke ");
  assertStringIncludes(lines[1], "◆ cli   1.10.0");
  assertStringIncludes(lines[2], "◆ core  1.42.0");
  assertEquals(new Set(lines.map((l) => l.length)).size, 1);
  const coloured = formatVersionPanel(
    rows,
    cliPaint({ rich: true, color: true, banner: true }),
  );
  assertEquals(stripAnsi(coloured), plainText);
});
