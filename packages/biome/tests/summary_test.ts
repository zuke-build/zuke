// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { BiomeCheckSettings, BiomeFormatSettings } from "../src/biome.ts";
import { parseBiomeSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("biome: the Checked line yields Files, and the Found lines the counts", () => {
  assertEquals(
    parseBiomeSummary(
      out(
        1,
        "Checked 120 files in 50ms. No fixes applied.\nFound 1 error.\nFound 2 warnings.\n",
      ),
    ),
    { Files: 120, Errors: 1, Warnings: 2 },
  );
  assertEquals(
    parseBiomeSummary(out(0, "Checked 1 file in 3ms. No fixes applied.\n")),
    { Files: 1, Errors: 0, Warnings: 0 },
  );
  assertEquals(
    parseBiomeSummary(
      out(0, "Checked 12 files in 8ms. Fixed 3 files.\nFound 4 warnings.\n"),
    ),
    { Files: 12, Errors: 0, Warnings: 4 },
  );
});

Deno.test("biome: a run that never printed the Checked line reports nothing", () => {
  assertEquals(
    parseBiomeSummary(
      out(1, "", "× Biome exited because the configuration is invalid."),
    ),
    undefined,
  );
  assertEquals(parseBiomeSummary(out(0)), undefined);
});

/** Exposes the protected hook so the wiring can be exercised without biome. */
class Probe extends BiomeCheckSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}
/** The hook lives on the shared base, so every subcommand has it. */
class FormatProbe extends BiomeFormatSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("biome: the hook on every subcommand reports the counts onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(
      out(1, "Checked 3 files in 2ms. No fixes applied.\nFound 1 error.\n"),
    );
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Files", value: "3" },
    { key: "Errors", value: "1" },
    { key: "Warnings", value: "0" },
  ]);
  const formatted = new TargetSummary();
  await withAmbientSummary(formatted, () => {
    new FormatProbe().probe(out(0, "Checked 5 files in 2ms. Fixed 2 files.\n"));
    return Promise.resolve();
  });
  assertEquals(formatted.entries()[0], { key: "Files", value: "5" });
});
