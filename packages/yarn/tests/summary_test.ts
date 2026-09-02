// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { YarnInstallSettings } from "../src/yarn.ts";
import { parseYarnSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("yarn: Berry fetch-step counts yield Added and Removed; Classic prints none", () => {
  const berry =
    "➤ YN0000: ┌ Resolution step\n➤ YN0000: └ Completed\n➤ YN0000: ┌ Fetch step\n➤ YN0013: │ 2 packages were added to the project (+ 46.4 KiB).\n➤ YN0013: │ 1 package was removed from the project (- 1.2 KiB).\n➤ YN0000: └ Completed\n➤ YN0000: · Done in 1s 2ms\n";
  assertEquals(parseYarnSummary(out(0, berry)), { Added: 2, Removed: 1 });
  const classic =
    "yarn install v1.22.22\n[1/4] Resolving packages...\n[4/4] Building fresh packages...\nsuccess Saved lockfile.\nDone in 1.23s.\n";
  assertEquals(parseYarnSummary(out(0, classic)), undefined);
  assertEquals(
    parseYarnSummary(out(1, "", "error Couldn't find package.json")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without yarn. */
class Probe extends YarnInstallSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("yarn: the hook reports onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(
      out(0, "➤ YN0013: │ 5 packages were added to the project (+ 1 MiB).\n"),
    );
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [{ key: "Added", value: "5" }, {
    key: "Removed",
    value: "0",
  }]);
});
