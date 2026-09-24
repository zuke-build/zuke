// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for the `QrTasks` surface and the package entrypoint. */

import {
  type ErrorCorrectionLevel,
  QrCapacityError,
  type QrCode,
  QrSettings,
  QrTasks,
} from "../mod.ts";
import { toRows, ZUKE_BUILD_M } from "./_golden.ts";
import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";

Deno.test("QrTasks.encode returns the module matrix", () => {
  const code: QrCode = QrTasks.encode("https://zuke.build");
  assertEquals(code.version, 2);
  assertEquals(code.errorCorrection, "Q");
  assertEquals(toRows(code.modules), ZUKE_BUILD_M);
});

Deno.test("QrTasks.encode honours the settings lambda", () => {
  const level: ErrorCorrectionLevel = "L";
  const code = QrTasks.encode(
    "https://zuke.build",
    (s) => s.errorCorrection(level).boostErrorCorrection(false),
  );
  // 18 bytes overflow version 1 at any level; without boosting L stays L.
  assertEquals(code.version, 2);
  assertEquals(code.errorCorrection, "L");
});

Deno.test("QrTasks.encode encodes text as UTF-8 bytes", () => {
  // 4 bytes of UTF-8 for one emoji → the same placement as four ASCII bytes.
  assertEquals(QrTasks.encode("🎉").version, QrTasks.encode("abcd").version);
});

Deno.test("QrTasks.encode surfaces the capacity error", () => {
  assertThrows(
    () => QrTasks.encode("x".repeat(3000)),
    QrCapacityError,
    "do not fit",
  );
});

Deno.test("QrTasks.renderLines and render agree, with the border applied", () => {
  const lines = QrTasks.renderLines("zuke", (s) => s.quietZone(1));
  // 21 modules + 2 border rows = 23 rows → 12 half-block lines, 23 wide.
  assertEquals(lines.length, 12);
  assertEquals([...lines[0]].length, 23);
  assertEquals(QrTasks.render("zuke", (s) => s.quietZone(1)), lines.join("\n"));
  assertStringIncludes(lines[1], "█");
});

Deno.test("QrTasks.print writes each line through the given writer", () => {
  const written: string[] = [];
  QrTasks.print("zuke", (s) => s.compact(false).quietZone(0), {
    write: (line) => written.push(line),
  });
  assertEquals(written.length, 21);
  assertEquals(written[0].startsWith("██████████████"), true);
});

Deno.test("QrTasks.print defaults to console.log", () => {
  const logged: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void logged.push(args.join(" "));
  try {
    QrTasks.print("zuke", (s) => s.quietZone(0));
  } finally {
    console.log = original;
  }
  assertEquals(logged, QrTasks.renderLines("zuke", (s) => s.quietZone(0)));
});

Deno.test("the entrypoint exports the settings class", () => {
  assertEquals(new QrSettings().errorCorrection("Q").errorCorrection_, "Q");
});
