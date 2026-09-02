// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { CypressRunSettings } from "../src/cypress.ts";
import { parseTestSummary } from "../src/test_summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

/** One spec's `(Results)` box, as cypress prints it. */
function box(
  tests: number,
  passing: number,
  failing: number,
  pending: number,
  skipped: number,
): string {
  const row = (label: string, n: number) =>
    `  │ ${label.padEnd(13)}${String(n).padEnd(52)}│\n`;
  return "  (Results)\n\n  ┌────────────────────────────────────────────────────────────────┐\n" +
    row("Tests:", tests) + row("Passing:", passing) + row("Failing:", failing) +
    row("Pending:", pending) + row("Skipped:", skipped) +
    row("Screenshots:", 0) +
    "  └────────────────────────────────────────────────────────────────┘\n";
}

Deno.test("cypress run: the per-spec Results boxes are summed", () => {
  const text = box(3, 2, 1, 0, 0) + "\n" + box(4, 3, 0, 1, 0) +
    "\n  ✖  1 of 2 failed (50%)\n";
  assertEquals(parseTestSummary(out(1, text)), {
    passed: 5,
    failed: 1,
    skipped: 1,
  });
  assertEquals(parseTestSummary(out(0, box(2, 2, 0, 0, 0))), {
    passed: 2,
    failed: 0,
    skipped: 0,
  });
  // Pending (it.skip) and skipped-after-failure both count as skipped.
  assertEquals(parseTestSummary(out(1, box(5, 1, 1, 2, 1))), {
    passed: 1,
    failed: 1,
    skipped: 3,
  });
});

Deno.test("cypress run: no Results box means nothing to report", () => {
  assertEquals(parseTestSummary(out(0)), undefined);
  assertEquals(
    parseTestSummary(out(1, "Could not find a Cypress configuration file.\n")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without cypress. */
class Probe extends CypressRunSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("cypress run: the hook reports the shared shape onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(0, box(3, 3, 0, 0, 0)));
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Tests", value: "3" },
    { key: "Passed", value: "3" },
    { key: "Failed", value: "0" },
  ]);
});
