// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { DprintCheckSettings, DprintFmtSettings } from "../src/dprint.ts";
import {
  parseDprintCheckSummary,
  parseDprintFmtSummary,
} from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("dprint check: the stderr closing line yields Unformatted, silence and exit 0 is zero", () => {
  assertEquals(
    parseDprintCheckSummary(
      out(20, "", "Found 2 not formatted files. Run dprint fmt to fix.\n"),
    ),
    { Unformatted: 2 },
  );
  assertEquals(
    parseDprintCheckSummary(
      out(
        20,
        "",
        "Compiling https://plugins.dprint.dev/typescript-0.93.0.wasm\nFound 1 not formatted file. Run dprint fmt to fix.\n",
      ),
    ),
    { Unformatted: 1 },
  );
  assertEquals(parseDprintCheckSummary(out(0)), { Unformatted: 0 });
  assertEquals(
    parseDprintCheckSummary(out(1, "", "error: No config file found")),
    undefined,
  );
});

Deno.test("dprint fmt: the stdout closing line yields Formatted, silence and exit 0 is zero", () => {
  assertEquals(
    parseDprintFmtSummary(out(0, "Formatted \x1b[1m3\x1b[0m files.\n")),
    { Formatted: 3 },
  );
  assertEquals(parseDprintFmtSummary(out(0, "Formatted 1 file.\n")), {
    Formatted: 1,
  });
  assertEquals(parseDprintFmtSummary(out(0)), { Formatted: 0 });
  assertEquals(
    parseDprintFmtSummary(out(1, "", "error: No config file found")),
    undefined,
  );
});

/** Exposes the protected hooks so the wiring can be exercised without dprint. */
class CheckProbe extends DprintCheckSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}
class FmtProbe extends DprintFmtSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("dprint: each subcommand reports its own figure onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new CheckProbe().probe(
      out(20, "", "Found 2 not formatted files. Run dprint fmt to fix.\n"),
    );
    new FmtProbe().probe(out(0, "Formatted 2 files.\n"));
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Unformatted", value: "2" },
    { key: "Formatted", value: "2" },
  ]);
});
