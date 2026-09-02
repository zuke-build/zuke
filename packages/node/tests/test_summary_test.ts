// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { NodeTestSettings } from "../src/node.ts";
import { parseTestSummary } from "../src/test_summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("node --test: the TAP block node prints when piped yields every category", () => {
  const tap =
    "1..4\n# tests 4\n# suites 0\n# pass 1\n# fail 1\n# cancelled 0\n# skipped 1\n# todo 1\n# duration_ms 158.3\n";
  assertEquals(parseTestSummary(out(1, tap)), {
    passed: 1,
    failed: 1,
    skipped: 1,
    todo: 1,
  });
});

Deno.test("node --test: the spec block it prints on a terminal is read the same way", () => {
  const spec =
    "ℹ tests 4\nℹ suites 0\nℹ pass 1\nℹ fail 1\nℹ cancelled 1\nℹ skipped 1\nℹ todo 0\nℹ duration_ms 89.5\n";
  // A cancelled test is one that never got its verdict because its parent
  // failed, so it counts as failed.
  assertEquals(parseTestSummary(out(1, spec)), {
    passed: 1,
    failed: 2,
    skipped: 1,
    todo: 0,
  });
});

Deno.test("node --test: no pass line means nothing to report", () => {
  assertEquals(parseTestSummary(out(0)), undefined);
  assertEquals(
    parseTestSummary(out(1, "", "node: bad option: --no-such-flag")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without node. */
class Probe extends NodeTestSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("node --test: the hook reports the shared shape onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(0, "# tests 2\n# pass 2\n# fail 0\n"));
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Tests", value: "2" },
    { key: "Passed", value: "2" },
    { key: "Failed", value: "0" },
  ]);
});
