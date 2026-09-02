// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import {
  reportSummary,
  TargetSummary,
  withAmbientSummary,
} from "../src/summary_note.ts";

Deno.test("TargetSummary keeps first-reported key order and replaces a repeated key in place", () => {
  const s = new TargetSummary();
  s.add({ Tests: 3, Passed: 2 });
  s.add({ Failed: 1, Tests: 4 });
  assertEquals(s.entries(), [
    { key: "Tests", value: "4" },
    { key: "Passed", value: "2" },
    { key: "Failed", value: "1" },
  ]);
});

Deno.test("TargetSummary collapses a key or value to one printable line", () => {
  const s = new TargetSummary();
  s.add({
    "Multi\nline  key": " a\r\nb\t c ",
    Styled: "\x1b[32m" + "green" + "\x1b[0m",
    Control: "bell" + "\x07" + "here",
  });
  assertEquals(s.entries(), [
    { key: "Multi line key", value: "a b c" },
    { key: "Styled", value: "green" },
    { key: "Control", value: "bell" + "here" },
  ]);
});

Deno.test("TargetSummary drops a key that is empty once collapsed", () => {
  const s = new TargetSummary();
  s.add({ "": "nothing", " \n ": "still nothing", Kept: "" });
  assertEquals(s.entries(), [{ key: "Kept", value: "" }]);
});

Deno.test("reportSummary lands in the ambient collector, scoped to its async subtree", async () => {
  const a = new TargetSummary();
  const b = new TargetSummary();
  // Two collectors interleaved on the same event loop: each report must reach
  // the collector installed for its own subtree, never the other's.
  await Promise.all([
    withAmbientSummary(a, async () => {
      await new Promise((r) => setTimeout(r, 5));
      reportSummary({ Who: "a" });
    }),
    withAmbientSummary(b, async () => {
      reportSummary({ Who: "b" });
      await new Promise((r) => setTimeout(r, 1));
      reportSummary({ Count: 2 });
    }),
  ]);
  assertEquals(a.entries(), [{ key: "Who", value: "a" }]);
  assertEquals(b.entries(), [
    { key: "Who", value: "b" },
    { key: "Count", value: "2" },
  ]);
});

Deno.test("reportSummary outside a running target is a no-op", () => {
  // No collector is installed here — the call must neither throw nor leak
  // into a collector installed later.
  reportSummary({ Lost: 1 });
  const s = new TargetSummary();
  return withAmbientSummary(s, async () => {
    await Promise.resolve();
    assertEquals(s.entries(), []);
  });
});

Deno.test("withAmbientSummary returns the function's result and unwinds the collector", async () => {
  const s = new TargetSummary();
  const value = await withAmbientSummary(s, () => Promise.resolve(42));
  assertEquals(value, 42);
  reportSummary({ After: "scope" });
  assertEquals(s.entries(), []);
});
