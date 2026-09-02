// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { TscAliasRunSettings } from "../src/tsc_alias.ts";
import { parseTscAliasSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("tsc-alias: the verbose closing line yields Files, silence yields nothing", () => {
  assertEquals(
    parseTscAliasSummary(out(0, "tsc-alias info: 3 files were affected!\n")),
    { Files: 3 },
  );
  assertEquals(
    parseTscAliasSummary(out(0, "tsc-alias info: 1 files were affected!\n")),
    { Files: 1 },
  );
  assertEquals(parseTscAliasSummary(out(0)), undefined);
  assertEquals(
    parseTscAliasSummary(out(1, "", "tsc-alias error: no tsconfig")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without tsc-alias. */
class Probe extends TscAliasRunSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("tsc-alias: the hook reports onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(0, "tsc-alias info: 2 files were affected!\n"));
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [{ key: "Files", value: "2" }]);
});
