// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { NpmCiSettings, NpmInstallSettings } from "../src/install.ts";
import { parseNpmSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("npm: the closing line yields Added, Removed and Changed, plus Vulnerabilities when audited", () => {
  assertEquals(parseNpmSummary(out(0, "\nadded 1 package in 441ms\n")), {
    Added: 1,
    Removed: 0,
    Changed: 0,
  });
  assertEquals(parseNpmSummary(out(0, "\nremoved 1 package in 213ms\n")), {
    Added: 0,
    Removed: 1,
    Changed: 0,
  });
  assertEquals(parseNpmSummary(out(0, "\nup to date in 206ms\n")), {
    Added: 0,
    Removed: 0,
    Changed: 0,
  });
  assertEquals(
    parseNpmSummary(
      out(
        0,
        "\nadded 120 packages, removed 2 packages, changed 3 packages, and audited 121 packages in 4s\n\nfound 0 vulnerabilities\n",
      ),
    ),
    { Added: 120, Removed: 2, Changed: 3, Vulnerabilities: 0 },
  );
  assertEquals(
    parseNpmSummary(
      out(
        0,
        "up to date, audited 2 packages in 1.2s\n\nfound 1 vulnerability\n",
      ),
    ),
    { Added: 0, Removed: 0, Changed: 0, Vulnerabilities: 1 },
  );
});

Deno.test("npm: a run without the closing line reports nothing", () => {
  assertEquals(parseNpmSummary(out(0)), undefined);
  assertEquals(parseNpmSummary(out(1, "", "npm error code ENOENT")), undefined);
});

/** Exposes the protected hook so the wiring can be exercised without npm. */
class Probe extends NpmInstallSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}
/** The hook lives on the dependency base, so `npm ci` has it too. */
class CiProbe extends NpmCiSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("npm: the hook on every dependency command reports onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(0, "added 3 packages in 1s\n"));
    return Promise.resolve();
  });
  assertEquals(summary.entries()[0], { key: "Added", value: "3" });
  const ci = new TargetSummary();
  await withAmbientSummary(ci, () => {
    new CiProbe().probe(out(0, "added 120 packages in 4s\n"));
    return Promise.resolve();
  });
  assertEquals(ci.entries()[0], { key: "Added", value: "120" });
});
