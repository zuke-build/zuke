// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandError } from "@zuke/core/shell";
import { parseTestSummary } from "../src/test_summary.ts";
import { DenoTasks } from "../src/deno.ts";

// The fixtures are addressed by `file://` URL, which is byte-identical on
// every OS — a URL's `pathname` is not: on Windows it reads `/D:/…`, which
// deno cannot open.
const PASSING = new URL("./fixtures/passing_suite.ts", import.meta.url).href;
const FAILING = new URL("./fixtures/failing_suite.ts", import.meta.url).href;

Deno.test("parseTestSummary reads the pretty/dot result line in each of its shapes", () => {
  assertEquals(parseTestSummary("ok | 5 passed | 0 failed (12ms)\n"), {
    passed: 5,
    failed: 0,
    skipped: 0,
  });
  assertEquals(
    parseTestSummary(
      "FAILED | 1 passed | 1 failed (66ms)\n\nerror: Test failed\n",
    ),
    { passed: 1, failed: 1, skipped: 0 },
  );
  assertEquals(
    parseTestSummary(
      "ok | 2 passed (2 steps) | 0 failed (1 step) | 1 ignored (3 steps) (50ms)",
    ),
    { passed: 2, failed: 0, skipped: 1 },
  );
  assertEquals(
    parseTestSummary(
      "ok | 1 passed | 0 failed | 2 measured | 3 filtered out (4ms)",
    ),
    { passed: 1, failed: 0, skipped: 0 },
  );
});

Deno.test("parseTestSummary ignores deno's colour codes and takes the last result line", () => {
  const styled =
    "\x1b[0m\x1b[32mok\x1b[0m | 3 passed | 0 failed \x1b[38;5;245m(9ms)\x1b[0m\n";
  assertEquals(parseTestSummary(styled), { passed: 3, failed: 0, skipped: 0 });
  // A test that prints a look-alike line cannot pose as the run's result: deno
  // prints its own line last.
  const echoed =
    "ok | 99 passed | 0 failed (1ms)\nFAILED | 1 passed | 2 failed (5ms)\n";
  assertEquals(parseTestSummary(echoed), { passed: 1, failed: 2, skipped: 0 });
});

Deno.test("parseTestSummary reads the segments by name, whatever order they come in", () => {
  // Deno prints ignored, then measured, then filtered out; a future release
  // that reorders or renames nothing but shuffles them must still parse.
  assertEquals(
    parseTestSummary(
      "ok | 3 filtered out | 2 measured | 1 ignored | 4 passed | 0 failed (7ms)",
    ),
    { passed: 4, failed: 0, skipped: 1 },
  );
  // A duration on the last segment must not swallow that segment's count.
  assertEquals(
    parseTestSummary("FAILED | 0 passed | 2 failed (1 step) (3ms)"),
    { passed: 0, failed: 2, skipped: 0 },
  );
  // A verdict line without both passed and failed is not a result line.
  assertEquals(parseTestSummary("ok | 3 filtered out (1ms)"), undefined);
  assertEquals(parseTestSummary("ok | 3 passed (1ms)"), undefined);
});

Deno.test("parseTestSummary reports nothing for output without a result line", () => {
  assertEquals(parseTestSummary(""), undefined);
  assertEquals(
    parseTestSummary('<testsuites tests="3"></testsuites>'),
    undefined,
  );
  assertEquals(parseTestSummary("  ok | 1 passed | 0 failed (1ms)"), undefined);
});

Deno.test("DenoTasks.test reports a real run's counts into the ambient summary", async () => {
  const summary = new TargetSummary();
  const out = await withAmbientSummary(
    summary,
    () => DenoTasks.test((s) => s.paths(PASSING).noCheck().quiet()),
  );
  assertEquals(out.code, 0);
  assertEquals(summary.entries(), [
    { key: "Tests", value: "3" },
    { key: "Passed", value: "2" },
    { key: "Failed", value: "0" },
    { key: "Skipped", value: "1" },
  ]);
});

Deno.test("DenoTasks.test reports the counts of a failed run before it throws", async () => {
  const summary = new TargetSummary();
  await assertRejects(
    () =>
      withAmbientSummary(
        summary,
        () => DenoTasks.test((s) => s.paths(FAILING).noCheck().quiet()),
      ),
    CommandError,
  );
  assertEquals(summary.entries(), [
    { key: "Tests", value: "2" },
    { key: "Passed", value: "1" },
    { key: "Failed", value: "1" },
  ]);
});

Deno.test("DenoTasks.test reports nothing under a reporter that prints no result line", async () => {
  const summary = new TargetSummary();
  await withAmbientSummary(
    summary,
    () =>
      DenoTasks.test((s) =>
        s.paths(PASSING).noCheck().reporter("junit").quiet()
      ),
  );
  assertEquals(summary.entries(), []);
});
