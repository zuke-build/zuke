// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandOutput } from "@zuke/core/shell";
import { EslintSettings } from "../src/eslint.ts";
import { parseEslintSummary } from "../src/summary.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("eslint: the stylish closing line yields Problems, Errors and Warnings", () => {
  assertEquals(
    parseEslintSummary(
      out(
        1,
        "\n✖ 5 problems (2 errors, 3 warnings)\n  1 error and 1 warning potentially fixable with the `--fix` option.\n",
      ),
    ),
    { Problems: 5, Errors: 2, Warnings: 3 },
  );
  assertEquals(
    parseEslintSummary(out(1, "✖ 1 problem (1 error, 0 warnings)\n")),
    { Problems: 1, Errors: 1, Warnings: 0 },
  );
  assertEquals(
    parseEslintSummary(
      out(0, "\x1b[31m✖ 2 problems (0 errors, 2 warnings)\x1b[0m\n"),
    ),
    { Problems: 2, Errors: 0, Warnings: 2 },
  );
});

Deno.test("eslint: a silent clean run is zero problems, a silent failure reports nothing", () => {
  assertEquals(parseEslintSummary(out(0)), {
    Problems: 0,
    Errors: 0,
    Warnings: 0,
  });
  assertEquals(
    parseEslintSummary(out(2, "", "Oops! Something went wrong!")),
    undefined,
  );
});

/** Exposes the protected hook so the wiring can be exercised without eslint. */
class Probe extends EslintSettings {
  probe(output: CommandOutput): void {
    this.onOutput(output);
  }
}

Deno.test("eslint: the hook reports the counts onto the running target", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(summary, () => {
    new Probe().probe(out(1, "✖ 3 problems (1 error, 2 warnings)\n"));
    return Promise.resolve();
  });
  assertEquals(summary.entries(), [
    { key: "Problems", value: "3" },
    { key: "Errors", value: "1" },
    { key: "Warnings", value: "2" },
  ]);
});
