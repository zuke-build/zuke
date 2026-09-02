// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: per-target summary notes, end to end through the CLI `main()`.
 * A body's `ctx.reportSummary` and the ambient `reportSummary` a helper with
 * no context calls land on the same row of the Build Summary, a target that
 * reports nothing keeps a plain row, and a failed target keeps the notes it
 * reported before failing.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, reportSummary, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

/** Stands in for a tool wrapper: reports what its tool printed, with no ctx. */
function runSuite(counts: { passed: number; failed: number }): Promise<void> {
  reportSummary({
    Tests: counts.passed + counts.failed,
    Passed: counts.passed,
    Failed: counts.failed,
  });
  return counts.failed === 0
    ? Promise.resolve()
    : Promise.reject(new Error(`${counts.failed} test(s) failed`));
}

class CI extends Build {
  test = target()
    .description("run the suite")
    .executes(async (ctx) => {
      await runSuite({ passed: 3, failed: 0 });
      ctx.reportSummary({ Version: "3.6.2" });
    });

  pack = target()
    .description("a target that reports nothing")
    .dependsOn(this.test)
    .executes(() => {});
}

class Broken extends Build {
  test = target()
    .description("run a suite with a failure")
    .executes(() => runSuite({ passed: 1, failed: 1 }));
}

/** The summary row for `name`, or `""` when the table has none. */
function row(out: string, name: string): string {
  return out.split("\n").find((l) =>
    l.startsWith(`${name} `) && /Succeeded|Failed/.test(l)
  ) ?? "";
}

Deno.test("a target's row carries the helper's counts and the body's own note", async () => {
  const r = await runCli(CI, ["pack"]);
  assertEquals(r.code, 0, r.err);
  assertStringIncludes(
    row(r.out, "test"),
    "// Tests: 3 · Passed: 3 · Failed: 0 · Version: 3.6.2",
  );
  assertEquals(row(r.out, "pack").includes("//"), false);
});

Deno.test("a failed target's row keeps the notes reported before the failure", async () => {
  const r = await runCli(Broken, ["test"]);
  assertEquals(r.code, 1);
  const line = row(r.out, "test");
  assertStringIncludes(line, "Failed");
  assertStringIncludes(line, "// Tests: 2 · Passed: 1 · Failed: 1");
});
