// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { BunTestSettings } from "../src/bun.ts";
import { parseTestSummary } from "../src/test_summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("bun test: the closing block on stderr yields every category", () => {
  const text =
    "\n 1 pass\n 1 skip\n 1 todo\n 1 fail\n 2 expect() calls\nRan 4 tests across 1 file. [114.00ms]\n";
  assertEquals(parseTestSummary(out(1, "bun test v1.3.11\n", text)), {
    passed: 1,
    failed: 1,
    skipped: 1,
    todo: 1,
  });
  assertEquals(
    parseTestSummary(
      out(0, "", " 12 pass\n 0 fail\nRan 12 tests across 3 files. [50.00ms]\n"),
    ),
    { passed: 12, failed: 0, skipped: 0, todo: 0 },
  );
});

Deno.test("bun test: a run without the Ran line did not complete and reports nothing", () => {
  assertEquals(
    parseTestSummary(out(1, "", "error: Cannot find module\n")),
    undefined,
  );
  assertEquals(parseTestSummary(out(0)), undefined);
});

/** Exposes the protected hook so the wiring can be exercised without bun. */
class Probe extends BunTestSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("bun test: the hook reports the shared shape onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(
      out(0, "", " 3 pass\n 1 skip\nRan 4 tests across 1 file. [9.00ms]\n"),
    );
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Tests", value: "4" },
    { key: "Passed", value: "3" },
    { key: "Failed", value: "0" },
    { key: "Skipped", value: "1" },
  ]);
});
