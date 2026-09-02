// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { PlaywrightTestSettings } from "../src/playwright.ts";
import { parseTestSummary } from "../src/test_summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("playwright test: the closing block yields every category", () => {
  const text =
    "\n  1 failed\n    tests/a.spec.ts:3:1 › two ───\n  1 flaky\n    tests/a.spec.ts:9:1 › five ───\n  1 skipped\n  2 passed (1.5s)\n";
  assertEquals(parseTestSummary(out(1, text)), {
    passed: 2,
    failed: 1,
    skipped: 1,
    flaky: 1,
  });
  assertEquals(parseTestSummary(out(0, "\n  3 passed (900ms)\n")), {
    passed: 3,
    failed: 0,
    skipped: 0,
    flaky: 0,
  });
  // Interrupted tests failed to finish; tests that did not run were skipped.
  assertEquals(
    parseTestSummary(
      out(1, "  1 failed\n  2 interrupted\n  3 did not run\n  4 passed (2s)\n"),
    ),
    { passed: 4, failed: 3, skipped: 3, flaky: 0 },
  );
});

Deno.test("playwright test: without a passed or failed line there is nothing to report", () => {
  assertEquals(parseTestSummary(out(0)), undefined);
  assertEquals(parseTestSummary(out(1, "Error: No tests found\n")), undefined);
  // A line further indented is a failure detail, not the closing block.
  assertEquals(
    parseTestSummary(out(1, "      1 passed of something else\n")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without playwright. */
class Probe extends PlaywrightTestSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("playwright test: the hook reports the shared shape onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(0, "  1 flaky\n  4 passed (3.1s)\n"));
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Tests", value: "5" },
    { key: "Passed", value: "4" },
    { key: "Failed", value: "0" },
    { key: "Flaky", value: "1" },
  ]);
});
