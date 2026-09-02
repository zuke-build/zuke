// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { VitestSettings } from "../src/vitest.ts";
import { parseTestSummary } from "../src/test_summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("vitest: the Tests line yields every category, in any order", () => {
  const text =
    " Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 2 passed | 1 skipped | 1 todo (5)\n   Duration  195ms\n";
  assertEquals(parseTestSummary(out(1, text)), {
    passed: 2,
    failed: 1,
    skipped: 1,
    todo: 1,
  });
  assertEquals(
    parseTestSummary(
      out(0, " Test Files  1 passed (1)\n      Tests  1 passed (1)\n"),
    ),
    { passed: 1, failed: 0, skipped: 0, todo: 0 },
  );
  assertEquals(
    parseTestSummary(
      out(
        0,
        "\x1b[2m      Tests \x1b[0m \x1b[1m\x1b[32m3 passed\x1b[39m\x1b[22m\x1b[90m (3)\x1b[39m\n",
      ),
    ),
    { passed: 3, failed: 0, skipped: 0, todo: 0 },
  );
});

Deno.test("vitest: no Tests line means nothing to report", () => {
  assertEquals(
    parseTestSummary(out(0, "No test files found, exiting with code 0\n")),
    undefined,
  );
  assertEquals(
    parseTestSummary(out(1, "", "Error: Failed to load config")),
    undefined,
  );
  // The Test Files line alone is not the tests line.
  assertEquals(
    parseTestSummary(out(0, " Test Files  1 passed (1)\n")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without vitest. */
class Probe extends VitestSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("vitest: the hook reports the shared shape onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(
      out(1, "      Tests  1 failed | 2 passed | 1 todo (4)\n"),
    );
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Tests", value: "4" },
    { key: "Passed", value: "2" },
    { key: "Failed", value: "1" },
    { key: "Todo", value: "1" },
  ]);
});
