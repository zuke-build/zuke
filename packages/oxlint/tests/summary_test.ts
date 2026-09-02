// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { OxlintSettings } from "../src/oxlint.ts";
import { parseOxlintSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("oxlint: the terminal closing line yields Errors and Warnings, with Files when timed", () => {
  const text =
    "Found 3 warnings and 1 error.\nFinished in 12ms on 40 files with 90 rules using 8 threads.\n";
  assertEquals(parseOxlintSummary(out(1, text)), {
    Errors: 1,
    Warnings: 3,
    Files: 40,
  });
  assertEquals(
    parseOxlintSummary(out(0, "Found 0 warnings and 0 errors.\n")),
    { Errors: 0, Warnings: 0 },
  );
});

Deno.test("oxlint: piped output has no closing line, so the diagnostics are counted", () => {
  const text = [
    "bad.js:1:7: warning eslint(no-unused-vars): Variable a is declared but never used.",
    "bad.js:2:5: warning eslint(no-unused-vars): Variable b is declared but never used.",
    "bad.js:3:13: error eslint(no-undef): c is not defined.",
    "",
  ].join("\n");
  assertEquals(parseOxlintSummary(out(1, text)), { Errors: 1, Warnings: 2 });
});

Deno.test("oxlint: a silent clean run is zero, a silent failure reports nothing", () => {
  assertEquals(parseOxlintSummary(out(0)), { Errors: 0, Warnings: 0 });
  assertEquals(
    parseOxlintSummary(out(1, "", "error: unknown option")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without oxlint. */
class Probe extends OxlintSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("oxlint: the hook reports the counts onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(0, "Found 2 warnings and 0 errors.\n"));
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Errors", value: "0" },
    { key: "Warnings", value: "2" },
  ]);
});
