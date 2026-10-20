// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the sharded test runner behind `zuke.ts`'s `test` target, end
 * to end through the CLI `main()`. Real `deno test` processes (the deno
 * already running the suite) run committed fixtures concurrently; the target's
 * summary row carries the counts summed across every shard, not the last
 * shard's, and a failing shard fails the target while the others still report.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { DenoTasks } from "../../packages/deno/mod.ts";
import { runShards } from "../../build/test_shards.ts";
import { runCli } from "./_harness.ts";

// Addressed by `file://` URL, which is byte-identical on every OS.
const PASSING = new URL(
  "../../packages/deno/tests/fixtures/passing_suite.ts",
  import.meta.url,
).href;
const FAILING = new URL(
  "../../packages/deno/tests/fixtures/failing_suite.ts",
  import.meta.url,
).href;
// No such file: deno exits before running any test, as it did on #852's runner.
const MISSING = new URL(
  "../../packages/deno/tests/fixtures/no_such_suite.ts",
  import.meta.url,
).href;

/**
 * A build whose `test` target runs `shards` the way `zuke.ts` does. `attempt`
 * picks the files each run is given, so a test can make the first run of a
 * shard die before it tests anything.
 */
function shardedBuild(
  shards: string[][],
  attempt: (paths: string[], run: number) => string[] = (paths) => paths,
): new () => Build {
  let runs = 0;
  return class extends Build {
    test = target()
      .description("run the fixture suites as shards")
      .executes(async () => {
        await runShards(
          shards,
          (paths) => {
            const files = attempt(paths, runs++);
            return DenoTasks.test((s) =>
              s.paths(...files).noCheck().quiet().noThrow()
            );
          },
        );
      });
  };
}

/** The summary row for `name`, or `""` when the table has none. */
function row(out: string, name: string): string {
  return out.split("\n").find((l) =>
    l.startsWith(`${name} `) && /Succeeded|Failed/.test(l)
  ) ?? "";
}

Deno.test("the test row sums every shard's counts", async () => {
  const r = await runCli(shardedBuild([[PASSING], [PASSING]]), ["test"]);
  assertEquals(r.code, 0, r.err);
  assertStringIncludes(
    row(r.out, "test"),
    "// Tests: 6 · Passed: 4 · Failed: 0 · Skipped: 2",
  );
  const first = r.out.indexOf("── test shard 1/2 ──");
  const second = r.out.indexOf("── test shard 2/2 ──");
  assertEquals(first >= 0 && second > first, true, r.out);
});

Deno.test("a failing shard fails the target, and the row still counts both", async () => {
  const r = await runCli(shardedBuild([[FAILING], [PASSING]]), ["test"]);
  assertEquals(r.code, 1);
  assertStringIncludes(
    row(r.out, "test"),
    "// Tests: 5 · Passed: 3 · Failed: 1 · Skipped: 1",
  );
  assertStringIncludes(
    `${r.out}\n${r.err}`,
    "1 of 2 test shard(s) failed — 1 failing test(s)",
  );
});

Deno.test("a shard whose deno died before testing is run again, and passes", async () => {
  const r = await runCli(
    shardedBuild([[PASSING]], (paths, run) => run === 0 ? [MISSING] : paths),
    ["test"],
  );
  assertEquals(r.code, 0, r.err);
  // Only the run that tested anything is counted.
  assertStringIncludes(
    row(r.out, "test"),
    "// Tests: 3 · Passed: 2 · Failed: 0 · Skipped: 1",
  );
  assertStringIncludes(r.out, "no_such_suite.ts");
  assertStringIncludes(
    r.out,
    "── test shard 1/1: deno exited before running any test; ran it again ──",
  );
});

Deno.test("a shard that dies before testing twice fails the target", async () => {
  const r = await runCli(shardedBuild([[MISSING]]), ["test"]);
  assertEquals(r.code, 1);
  assertStringIncludes(
    `${r.out}\n${r.err}`,
    "Shard(s) 1 exited before printing a result line",
  );
});
