// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { ShellcheckSettings } from "../src/shellcheck.ts";
import { parseShellcheckSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("shellcheck: findings are counted in the tty and gcc layouts", () => {
  const tty = [
    "",
    "In bad.sh line 2:",
    "echo $1",
    "     ^-- SC2086 (info): Double quote to prevent globbing.",
    "",
    "",
    "In bad.sh line 3:",
    "foo=`ls`",
    "    ^--^ SC2006 (style): Use $(...) notation.",
    "",
    "For more information:",
    "  https://www.shellcheck.net/wiki/SC2086",
  ].join("\n");
  assertEquals(parseShellcheckSummary(out(1, tty)), { Findings: 2 });
  const gcc =
    "bad.sh:2:6: note: Double quote to prevent globbing. [SC2086]\nbad.sh:3:5: warning: Use $(...) notation. [SC2006]\nbad.sh:4:1: error: Unexpected end. [SC1056]\n";
  assertEquals(parseShellcheckSummary(out(1, gcc)), { Findings: 3 });
});

Deno.test("shellcheck: a silent clean run is zero, a silent failure reports nothing", () => {
  assertEquals(parseShellcheckSummary(out(0)), { Findings: 0 });
  assertEquals(
    parseShellcheckSummary(
      out(2, "", "bad.sh: bad.sh: openBinaryFile: does not exist"),
    ),
    undefined,
  );
  // A layout with nothing to count, such as json, reports nothing on a failure.
  assertEquals(parseShellcheckSummary(out(1, '[{"line":2}]')), undefined);
});

/** Exposes the protected hook so the wiring can be exercised without shellcheck. */
class Probe extends ShellcheckSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("shellcheck: the hook reports onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(0));
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [{ key: "Findings", value: "0" }]);
});
