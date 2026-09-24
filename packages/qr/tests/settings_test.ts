// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for the fluent `QrSettings`. */

import { QrSettings } from "../src/settings.ts";
import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";

Deno.test("QrSettings defaults favour a compact, level-M code with a small border", () => {
  const s = new QrSettings();
  assertEquals(s.errorCorrection_, "M");
  assertEquals(s.boostErrorCorrection_, true);
  assertEquals(s.quietZone_, 2);
  assertEquals(s.invert_, false);
  assertEquals(s.compact_, true);
});

Deno.test("every setter chains and records its value", () => {
  const s = new QrSettings()
    .errorCorrection("H")
    .boostErrorCorrection(false)
    .quietZone(4)
    .invert()
    .compact(false);
  assertEquals(s.errorCorrection_, "H");
  assertEquals(s.boostErrorCorrection_, false);
  assertEquals(s.quietZone_, 4);
  assertEquals(s.invert_, true);
  assertEquals(s.compact_, false);
  assertEquals(s.invert(false).invert_, false);
  assertEquals(s.compact().compact_, true);
  assertEquals(s.boostErrorCorrection().boostErrorCorrection_, true);
});

Deno.test("quietZone rejects a negative or fractional width", () => {
  assertThrows(() => new QrSettings().quietZone(-1), RangeError, "got -1");
  assertThrows(() => new QrSettings().quietZone(1.5), RangeError, "got 1.5");
});
