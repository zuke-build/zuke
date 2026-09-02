// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { CspellSettings } from "../src/cspell.ts";
import { parseCspellSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("cspell: the closing line on stderr yields Files and Issues", () => {
  assertEquals(
    parseCspellSummary(
      out(1, "", "CSpell: Files checked: 1000, Issues found: 4 in 3 files.\n"),
    ),
    { Files: 1000, Issues: 4 },
  );
  assertEquals(
    parseCspellSummary(
      out(0, "", "CSpell: Files checked: 1, Issues found: 0 in 0 files.\n"),
    ),
    { Files: 1, Issues: 0 },
  );
});

Deno.test("cspell: a run without the closing line reports nothing", () => {
  assertEquals(parseCspellSummary(out(0)), undefined);
  assertEquals(
    parseCspellSummary(out(1, "", "error: unknown option --no-config")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without cspell. */
class Probe extends CspellSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("cspell: the hook reports the counts onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(
      out(1, "", "CSpell: Files checked: 12, Issues found: 2 in 1 file.\n"),
    );
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Files", value: "12" },
    { key: "Issues", value: "2" },
  ]);
});
