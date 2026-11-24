// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A self-contained suite with one passing and one failing test, so a failed
 * `DenoTasks.test` run still has counts to report. Not named `*_test.ts` on
 * purpose — the workspace's own test discovery must not pick it up.
 */

Deno.test("passes", () => {});

Deno.test("fails", () => {
  throw new Error("expected failure");
});
