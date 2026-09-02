// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { JestSettings } from "../src/jest.ts";
import { parseTestSummary } from "../src/test_summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("jest: the Tests: line on stderr yields every category, in any order", () => {
  const text =
    "Test Suites: 1 failed, 1 passed, 2 total\nTests:       1 failed, 1 skipped, 1 todo, 2 passed, 5 total\nSnapshots:   0 total\nTime:        0.57 s\n";
  assertEquals(parseTestSummary(out(1, "", text)), {
    passed: 2,
    failed: 1,
    skipped: 1,
    todo: 1,
  });
  assertEquals(
    parseTestSummary(
      out(
        0,
        "",
        "Test Suites: 1 passed, 1 total\nTests:       1 passed, 1 total\n",
      ),
    ),
    { passed: 1, failed: 0, skipped: 0, todo: 0 },
  );
  assertEquals(
    parseTestSummary(
      out(
        0,
        "",
        "\x1b[1mTests:\x1b[22m       \x1b[1m\x1b[32m3 passed\x1b[39m\x1b[22m, 3 total\n",
      ),
    ),
    { passed: 3, failed: 0, skipped: 0, todo: 0 },
  );
});

Deno.test("jest: no Tests: line, or one without a total, means nothing to report", () => {
  assertEquals(parseTestSummary(out(0)), undefined);
  assertEquals(
    parseTestSummary(out(1, "", "No tests found, exiting with code 1")),
    undefined,
  );
  assertEquals(
    parseTestSummary(out(0, "", "Tests: something else entirely\n")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without jest. */
class Probe extends JestSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("jest: the hook reports the shared shape onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(
      out(1, "", "Tests:       1 failed, 1 skipped, 2 passed, 4 total\n"),
    );
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Tests", value: "4" },
    { key: "Passed", value: "2" },
    { key: "Failed", value: "1" },
    { key: "Skipped", value: "1" },
  ]);
});
