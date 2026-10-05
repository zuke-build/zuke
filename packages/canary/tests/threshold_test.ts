// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Unit tests for `metricThreshold(...)` and the shared bounds check. */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { metricThreshold, type MetricThresholdSettings } from "../mod.ts";
import { checkThreshold } from "../src/threshold.ts";
import { analysisContext } from "./_context.ts";

Deno.test("a metric within bounds passes, and the reader sees the rollout", async () => {
  let seen = 0;
  const analysis = metricThreshold((m) =>
    m.name("error ratio").read((ctx) => {
      seen = ctx.exposure;
      return 0.005;
    }).min(0).max(0.01)
  );
  assertEquals(analysis.name, "metricThreshold");
  await analysis.validate(analysisContext());
  assertEquals(seen, 10);
});

Deno.test("a metric out of bounds fails, naming it", async () => {
  await assertRejects(
    async () =>
      await metricThreshold((m) =>
        m.name("error ratio").read(() => 0.2).max(0.01)
      ).validate(analysisContext()),
    Error,
    "error ratio is 0.2, above the maximum 0.01",
  );
  await assertRejects(
    async () =>
      await metricThreshold((m) => m.read(() => Promise.resolve(3)).min(5))
        .validate(analysisContext()),
    Error,
    "metric is 3, below the minimum 5",
  );
});

Deno.test("a metric with no reader or no bound is refused", async () => {
  await assertRejects(
    async () =>
      await metricThreshold((m) => m.max(1)).validate(analysisContext()),
    Error,
    "has no reader",
  );
  await assertRejects(
    async () =>
      await metricThreshold((m) => m.read(() => 1)).validate(analysisContext()),
    Error,
    "sets no bound",
  );
});

Deno.test("a reading that is not a number fails", () => {
  assertThrows(
    () => checkThreshold("x", Number.NaN, { max: 1 }),
    Error,
    "not a number",
  );
  checkThreshold("x", 1, { max: 1, min: 1 });
});

Deno.test("a reader's failure has the credentials in its URLs cleaned", async () => {
  const error = await assertRejects(
    async () =>
      await metricThreshold((m) =>
        m.read(() => {
          throw new Error(
            "GET https://u:pw@metrics.example/q?token=abc failed",
          );
        }).max(1)
      ).validate(analysisContext()),
    Error,
  );
  assertStringIncludes(
    String(error),
    "GET https://metrics.example/q?token=REDACTED failed",
  );
  for (const secret of ["pw@", "token=abc"]) {
    assertEquals(String(error).includes(secret), false, secret);
  }
});

Deno.test("bounds that could never judge anything are refused", async () => {
  const cases: Array<
    [(m: MetricThresholdSettings) => MetricThresholdSettings, string]
  > = [
    [(m) => m.read(() => 999).max(Number.NaN), "not a number"],
    [(m) => m.read(() => 5).min(10).max(1), "can never pass"],
  ];
  for (const [configure, message] of cases) {
    await assertRejects(
      async () => await metricThreshold(configure).validate(analysisContext()),
      Error,
      message,
    );
  }
});

Deno.test("a failing metric's message is redacted", async () => {
  const error = await assertRejects(
    async () =>
      await metricThreshold((m) => m.name("s3cr3t ratio").read(() => 2).max(1))
        .validate(analysisContext()),
    Error,
  );
  assertEquals(String(error).includes("s3cr3t"), false);
});
