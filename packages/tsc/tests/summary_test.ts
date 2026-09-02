// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { TscBuildSettings, TscSettings } from "../src/tsc.ts";
import { parseTscSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("tsc: the diagnostics are counted in the plain and the pretty layouts", () => {
  const plain =
    "src/a.ts(1,7): error TS2322: Type string is not assignable to type number.\nsrc/b.ts(4,1): error TS1005: ; expected.\n";
  assertEquals(parseTscSummary(out(2, plain)), { Errors: 2 });
  // The pretty layout paints the path, position and severity separately.
  const pretty = "\x1b[96m" + "src/a.ts" +
    "\x1b[0m:\x1b[93m1\x1b[0m:\x1b[93m7" +
    "\x1b[0m - \x1b[91m" + "error" + "\x1b[0m\x1b[90m TS2322: \x1b[0m" +
    "Type string is not assignable to type number.\n\n\nFound 1 error in src/a.ts:1\n";
  assertEquals(parseTscSummary(out(2, pretty)), { Errors: 1 });
});

Deno.test("tsc: a silent clean run is zero errors, a silent failure reports nothing", () => {
  assertEquals(parseTscSummary(out(0)), { Errors: 0 });
  assertEquals(
    parseTscSummary(out(1, "", "error TS5023: Unknown compiler option")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without tsc. */
class Probe extends TscSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}
/** The hook lives on the shared base, so `tsc --build` has it too. */
class BuildProbe extends TscBuildSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("tsc: the hook reports the error count onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(2, "a.ts(1,1): error TS1005: ; expected.\n"));
    new BuildProbe().probe(out(0));
    return Promise.resolve();
  });
  // The second report replaces the first: a target that runs tsc twice keeps
  // the last run figure on its row.
  assertEquals(summary.entries(), [{ key: "Errors", value: "0" }]);
});
