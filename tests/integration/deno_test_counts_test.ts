// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: `DenoTasks.test`'s counts on the Build Summary, end to end
 * through the CLI `main()`. A `test` target running the wrapper on a committed
 * fixture gets its counts on its row without the build author writing a
 * thing; a body's own `ctx.reportSummary` lands on the same row; and a failed
 * run still says how many failed. The fixture is run by the deno already
 * executing the suite (the wrapper's default binary), so it stays hermetic.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { DenoTasks } from "../../packages/deno/mod.ts";
import { runCli } from "./_harness.ts";

const PASSING = new URL(
  "../../packages/deno/tests/fixtures/passing_suite.ts",
  import.meta.url,
).pathname;
const FAILING = new URL(
  "../../packages/deno/tests/fixtures/failing_suite.ts",
  import.meta.url,
).pathname;

class CI extends Build {
  test = target()
    .description("run the fixture suite")
    .executes(async (ctx) => {
      await DenoTasks.test((s) => s.paths(PASSING).noCheck().quiet());
      ctx.reportSummary({ Version: "3.6.2" });
    });

  pack = target()
    .description("a target that reports nothing")
    .dependsOn(this.test)
    .executes(() => {});
}

class Broken extends Build {
  test = target()
    .description("run the failing fixture suite")
    .executes(() => DenoTasks.test((s) => s.paths(FAILING).noCheck().quiet()));
}

/** The summary row for `name`, or `""` when the table has none. */
function row(out: string, name: string): string {
  return out.split("\n").find((l) =>
    l.startsWith(`${name} `) && /Succeeded|Failed/.test(l)
  ) ?? "";
}

Deno.test("the test target's row carries the run's counts and the body's own note", async () => {
  const r = await runCli(CI, ["pack"]);
  assertEquals(r.code, 0, r.err);
  assertStringIncludes(
    row(r.out, "test"),
    "// Tests: 3 · Passed: 2 · Failed: 0 · Ignored: 1 · Version: 3.6.2",
  );
  assertEquals(row(r.out, "pack").includes("//"), false);
});

Deno.test("a failed test target's row says how many tests failed", async () => {
  const r = await runCli(Broken, ["test"]);
  assertEquals(r.code, 1);
  const line = row(r.out, "test");
  assertStringIncludes(line, "Failed");
  assertStringIncludes(line, "// Tests: 2 · Passed: 1 · Failed: 1");
});
