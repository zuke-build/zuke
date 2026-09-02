// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { DpdmAnalyzeSettings } from "../src/dpdm.ts";
import { parseDpdmSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("dpdm: the numbered entries under the circular heading are counted", () => {
  assertEquals(
    parseDpdmSummary(
      out(
        0,
        "• Circular Dependencies\n  1) a.js -> b.js\n  2) c.js -> d.js -> c.js\n\n",
      ),
    ),
    { Circular: 2 },
  );
  assertEquals(
    parseDpdmSummary(
      out(
        0,
        "• Circular Dependencies\n  ✅ Congratulations, no circular dependency was found in your project.\n\n",
      ),
    ),
    { Circular: 0 },
  );
  // A later section with its own numbered entries does not inflate the figure.
  assertEquals(
    parseDpdmSummary(
      out(
        1,
        "• Circular Dependencies\n  1) a.js -> b.js\n\n• Warnings\n  1) skip x.d.ts\n  2) skip y.d.ts\n",
      ),
    ),
    { Circular: 1 },
  );
});

Deno.test("dpdm: a run without the heading reports nothing", () => {
  assertEquals(parseDpdmSummary(out(0)), undefined);
  assertEquals(parseDpdmSummary(out(1, "", "Cannot find module")), undefined);
});

/** Exposes the protected hook so the wiring can be exercised without dpdm. */
class Probe extends DpdmAnalyzeSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("dpdm: the hook reports onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(0, "• Circular Dependencies\n  1) a.js -> b.js\n"));
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [{ key: "Circular", value: "1" }]);
});
