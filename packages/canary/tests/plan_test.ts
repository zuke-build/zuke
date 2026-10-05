// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Unit tests for the canary plan: what it builds and what it refuses. */

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import type { LockSettings } from "@zuke/core";
import { planCanary } from "../src/plan.ts";
import { FakePlatform } from "./_platform.ts";

Deno.test("steps become phases with their bakes, overrides included", () => {
  const plan = planCanary((c) =>
    c.platform(new FakePlatform()).steps(10, 50).bake("1m").bakeStep(2, "5m")
  );
  assertEquals(plan.phases, [
    { key: "step1", step: 1, percent: 10, bakeMs: 60_000 },
    { key: "step2", step: 2, percent: 50, bakeMs: 300_000 },
  ]);
  assertEquals(plan.analysisIntervalMs, 60_000);
  assertEquals(plan.durable, false);
});

Deno.test("a canary with no steps soaks only when it bakes or analyses", () => {
  const platform = new FakePlatform("channel");
  assertEquals(planCanary((c) => c.platform(platform)).phases, []);
  assertEquals(planCanary((c) => c.platform(platform).bake("1m")).phases, [
    { key: "soak", step: 0, bakeMs: 60_000 },
  ]);
  const analysed = planCanary((c) =>
    c.platform(platform).analysis({ validate: () => {} })
  );
  assertEquals(analysed.phases, [{ key: "soak", step: 0, bakeMs: 0 }]);
});

Deno.test("approval, its timeout, the lock and durability are carried through", () => {
  const lock = (l: LockSettings) => l;
  const plan = planCanary((c) =>
    c.platform(new FakePlatform()).approval("ok").approvalTimeout("1h")
      .lock(lock).durable().analysisInterval("30s")
  );
  assertEquals(plan.approval, { signal: "ok", timeout: "1h" });
  assertEquals(plan.lock, lock);
  assertEquals(plan.durable, true);
  assertEquals(plan.analysisIntervalMs, 30_000);
});

Deno.test("a canary that could not roll out is refused with the fix", () => {
  const traffic = new FakePlatform();
  const cases: Array<[string, () => unknown]> = [
    ["no platform", () => planCanary((c) => c)],
    [
      "declare no .steps",
      () =>
        planCanary((c) => c.platform(new FakePlatform("channel")).steps(10)),
    ],
    [
      "must increase",
      () => planCanary((c) => c.platform(traffic).steps(50, 10)),
    ],
    ["must increase", () => planCanary((c) => c.platform(traffic).steps(0))],
    ["must increase", () => planCanary((c) => c.platform(traffic).steps(100))],
    [
      "must increase",
      () => planCanary((c) => c.platform(traffic).steps(Number.NaN)),
    ],
    [
      "names no step",
      () => planCanary((c) => c.platform(traffic).steps(10).bakeStep(2, "1m")),
    ],
    [
      "names no step",
      () =>
        planCanary((c) => c.platform(traffic).steps(10).bakeStep(1.5, "1m")),
    ],
    [
      "without .approval",
      () => planCanary((c) => c.platform(traffic).approvalTimeout("1h")),
    ],
    ["bake soon", () => planCanary((c) => c.platform(traffic).bake("soon"))],
    [
      "analysis interval must be positive",
      () => planCanary((c) => c.platform(traffic).analysisInterval(0)),
    ],
    [
      "longer than the longest timer",
      () => planCanary((c) => c.platform(traffic).bake("30d")),
    ],
    [
      "bake -1",
      () => planCanary((c) => c.platform(traffic).bake(-1)),
    ],
  ];
  for (const [message, build] of cases) {
    const error = assertThrows(build);
    assertStringIncludes(String(error), message);
  }
});

Deno.test("only durations that become timers are held under the longest one", () => {
  const platform = new FakePlatform();
  const durable = planCanary((c) =>
    c.platform(platform).steps(10).bake("30d").durable().approval("ok")
      .approvalTimeout("30d")
  );
  assertEquals(durable.phases[0].bakeMs, 30 * 86_400_000);
  assertThrows(
    () => planCanary((c) => c.platform(platform).steps(10).bake("30d")),
    Error,
    "longer than the longest timer",
  );
});
