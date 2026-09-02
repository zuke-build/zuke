// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import {
  BunAddSettings,
  BunInstallSettings,
  BunRemoveSettings,
} from "../src/bun.ts";
import { parseBunInstallSummary } from "../src/install_summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("bun install: the closing line yields Installed and Removed", () => {
  assertEquals(
    parseBunInstallSummary(
      out(
        0,
        "bun install v1.3.11 (af24e281)\n\n+ left-pad@1.3.0\n\n1 package installed [106.00ms]\n",
      ),
    ),
    { Installed: 1, Removed: 0 },
  );
  assertEquals(
    parseBunInstallSummary(
      out(
        0,
        "bun install v1.3.11\n\nChecked 1 install across 2 packages (no changes) [2.00ms]\n",
      ),
    ),
    { Installed: 0, Removed: 0 },
  );
  assertEquals(
    parseBunInstallSummary(out(0, "\n2 packages removed [5.00ms]\n")),
    { Installed: 0, Removed: 2 },
  );
});

Deno.test("bun install: a run without the closing line reports nothing", () => {
  assertEquals(parseBunInstallSummary(out(0)), undefined);
  assertEquals(
    parseBunInstallSummary(
      out(1, "bun install v1.3.11\n", "error: package.json not found"),
    ),
    undefined,
  );
});

/** Exposes the protected hooks so the wiring can be exercised without bun. */
class Probe extends BunInstallSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}
class AddProbe extends BunAddSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}
class RemoveProbe extends BunRemoveSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("bun install, add and remove report onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(0, "3 packages installed [9ms]\n"));
    new AddProbe().probe(out(0, "1 package installed [9ms]\n"));
    new RemoveProbe().probe(out(0, "1 package removed [9ms]\n"));
    return Promise.resolve();
  });
  // Each report replaces the last: the row keeps the final command's figures.
  assertEquals(summary.entries(), [{ key: "Installed", value: "0" }, {
    key: "Removed",
    value: "1",
  }]);
});
