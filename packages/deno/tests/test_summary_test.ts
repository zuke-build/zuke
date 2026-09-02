// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandError } from "@zuke/core/shell";
import { parseTestSummary, testSummaryPairs } from "../src/test_summary.ts";
import { DenoTasks } from "../src/deno.ts";

const PASSING =
  new URL("./fixtures/passing_suite.ts", import.meta.url).pathname;
const FAILING =
  new URL("./fixtures/failing_suite.ts", import.meta.url).pathname;

Deno.test("parseTestSummary reads the pretty/dot result line in each of its shapes", () => {
  assertEquals(parseTestSummary("ok | 5 passed | 0 failed (12ms)\n"), {
    passed: 5,
    failed: 0,
    ignored: 0,
  });
  assertEquals(
    parseTestSummary(
      "FAILED | 1 passed | 1 failed (66ms)\n\nerror: Test failed\n",
    ),
    { passed: 1, failed: 1, ignored: 0 },
  );
  assertEquals(
    parseTestSummary(
      "ok | 2 passed (2 steps) | 0 failed (1 step) | 1 ignored (3 steps) (50ms)",
    ),
    { passed: 2, failed: 0, ignored: 1 },
  );
  assertEquals(
    parseTestSummary(
      "ok | 1 passed | 0 failed | 2 measured | 3 filtered out (4ms)",
    ),
    { passed: 1, failed: 0, ignored: 0 },
  );
});

Deno.test("parseTestSummary ignores deno's colour codes and takes the last result line", () => {
  const styled =
    "\x1b[0m\x1b[32mok\x1b[0m | 3 passed | 0 failed \x1b[38;5;245m(9ms)\x1b[0m\n";
  assertEquals(parseTestSummary(styled), { passed: 3, failed: 0, ignored: 0 });
  // A test that prints a look-alike line cannot pose as the run's result: deno
  // prints its own line last.
  const echoed =
    "ok | 99 passed | 0 failed (1ms)\nFAILED | 1 passed | 2 failed (5ms)\n";
  assertEquals(parseTestSummary(echoed), { passed: 1, failed: 2, ignored: 0 });
});

Deno.test("parseTestSummary reports nothing for output without a result line", () => {
  assertEquals(parseTestSummary(""), undefined);
  assertEquals(
    parseTestSummary('<testsuites tests="3"></testsuites>'),
    undefined,
  );
  assertEquals(parseTestSummary("  ok | 1 passed | 0 failed (1ms)"), undefined);
});

Deno.test("testSummaryPairs totals the selected tests and names Ignored only when non-zero", () => {
  assertEquals(testSummaryPairs({ passed: 4, failed: 1, ignored: 0 }), {
    Tests: 5,
    Passed: 4,
    Failed: 1,
  });
  assertEquals(testSummaryPairs({ passed: 2, failed: 0, ignored: 1 }), {
    Tests: 3,
    Passed: 2,
    Failed: 0,
    Ignored: 1,
  });
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
    { key: "Ignored", value: "1" },
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
