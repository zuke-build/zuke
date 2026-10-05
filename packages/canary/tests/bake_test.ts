// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Unit tests for the inline bake and the durable bake trigger. */

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import type { JsonValue, TargetStateHandle, WaitContext } from "@zuke/core";
import { bakeElapsed, bakeFor } from "../src/bake.ts";

/** An in-memory state handle. */
function memoryState(): TargetStateHandle {
  let data: Record<string, JsonValue> = {};
  return {
    set: (patch) => {
      data = { ...data, ...patch };
      return Promise.resolve();
    },
    trySet: (patch) => {
      data = { ...data, ...patch };
      return Promise.resolve(true);
    },
    get: () => data,
  };
}

Deno.test("an inline bake waits its time", async () => {
  const started = Date.now();
  await bakeFor(30, new AbortController().signal);
  assertEquals(Date.now() - started >= 25, true);
});

Deno.test("an inline bake ends at once when the run is cancelled", async () => {
  const stop = new AbortController();
  const started = Date.now();
  setTimeout(() => stop.abort(new Error("cancelled")), 10);
  await assertRejects(() => bakeFor(5_000, stop.signal), Error, "cancelled");
  assertEquals(Date.now() - started < 2_000, true);
  const already = new AbortController();
  already.abort(new Error("gone"));
  await assertRejects(() => bakeFor(5_000, already.signal), Error, "gone");
});

Deno.test("a durable bake starts its clock on the first check and opens when it is up", async () => {
  let now = 1_000;
  const trigger = bakeElapsed(60_000, () => now);
  const context: WaitContext = {
    state: memoryState(),
    runId: "run-1",
    target: "rollout.step1.bake",
  };
  assertEquals(trigger.descriptor, "bake:60000ms");
  assertEquals(trigger.pollIntervalMs, 60_000);
  assertEquals(await trigger.isSatisfied(new Map(), context), false);
  assertEquals(context.state.get().bakeStartedAt, 1_000);
  now = 30_000;
  assertEquals(await trigger.isSatisfied(new Map(), context), false);
  now = 61_000;
  assertEquals(await trigger.isSatisfied(new Map(), context), true);
  // A short bake asks to be re-checked soon, but not more than once a second.
  assertEquals(bakeElapsed(10).pollIntervalMs, 1000);
  assertEquals(bakeElapsed(5_000).pollIntervalMs, 5_000);
});
