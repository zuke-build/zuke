// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A self-contained suite `DenoTasks.test` is pointed at by explicit path: two
 * passing tests (one with steps) and one ignored, so the result line carries
 * every count the wrapper reports. Not named `*_test.ts` on purpose — the
 * workspace's own test discovery must not pick it up.
 */

Deno.test("adds", () => {
  if ([1, 1].reduce((a, b) => a + b) !== 2) throw new Error("arithmetic");
});

Deno.test("steps", async (t) => {
  await t.step("first", () => {});
  await t.step("second", () => {});
});

Deno.test({ name: "skipped", ignore: true, fn: () => {} });
