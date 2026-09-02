// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { PnpmInstallSettings, PnpmRunSettings } from "../src/pnpm.ts";
import { parsePnpmSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("pnpm: the settled progress line yields Added, Downloaded and Reused", () => {
  const text =
    "Progress: resolved 120, reused 100, downloaded 20, added 120, done\n\ndependencies:\n+ left-pad 1.3.0\n\nDone in 883ms using pnpm v11.25.0\n";
  assertEquals(parsePnpmSummary(out(0, text)), {
    Added: 120,
    Downloaded: 20,
    Reused: 100,
  });
  assertEquals(
    parsePnpmSummary(
      out(
        0,
        "Lockfile is up to date, resolution step is skipped\nAlready up to date\nDone in 200ms\n",
      ),
    ),
    { Added: 0, Downloaded: 0, Reused: 0 },
  );
});

Deno.test("pnpm: a run without either line reports nothing", () => {
  assertEquals(parsePnpmSummary(out(0)), undefined);
  assertEquals(
    parsePnpmSummary(out(0, "> app@1.0.0 build\n> tsc\n")),
    undefined,
  );
  assertEquals(
    parsePnpmSummary(out(1, "", " ERR_PNPM_NO_PKG_MANIFEST")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without pnpm. */
class Probe extends PnpmInstallSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}
/** The hook lives on the base; a script run prints no progress line and reports nothing. */
class RunProbe extends PnpmRunSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("pnpm: the hook reports onto the running target, and a script run stays silent", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(
      out(0, "Progress: resolved 3, reused 3, downloaded 0, added 3, done\n"),
    );
    new RunProbe().probe(out(0, "> app@1.0.0 build\n"));
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Added", value: "3" },
    { key: "Downloaded", value: "0" },
    { key: "Reused", value: "3" },
  ]);
});
