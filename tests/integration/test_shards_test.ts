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

/** A build whose `test` target runs `shards` the way `zuke.ts` does. */
function shardedBuild(shards: string[][]): new () => Build {
  return class extends Build {
    test = target()
      .description("run the fixture suites as shards")
      .executes(async () => {
        await runShards(
          shards,
          (paths) =>
            DenoTasks.test((s) =>
              s.paths(...paths).noCheck().quiet().noThrow()
            ),
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
