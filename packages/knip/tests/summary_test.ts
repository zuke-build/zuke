// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { KnipRunSettings } from "../src/knip.ts";
import { parseKnipSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("knip: the section counts are summed into Issues", () => {
  const text =
    "Unused files (1)\norphan.js\nUnused dependencies (1)\nleft-pad  package.json\nUnused exports (2)\na.js: x\nb.js: y\n";
  assertEquals(parseKnipSummary(out(1, text)), { Issues: 4 });
  assertEquals(parseKnipSummary(out(1, "Unlisted dependencies (3)\n")), {
    Issues: 3,
  });
});

Deno.test("knip: a silent clean run is zero, a silent failure reports nothing", () => {
  assertEquals(parseKnipSummary(out(0)), { Issues: 0 });
  assertEquals(
    parseKnipSummary(out(2, "", "Unable to find a config")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without knip. */
class Probe extends KnipRunSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("knip: the hook reports onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(1, "Unused files (2)\na.js\nb.js\n"));
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [{ key: "Issues", value: "2" }]);
});
