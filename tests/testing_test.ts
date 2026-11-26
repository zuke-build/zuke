// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `test` from `tests/_testing.ts`: a test that says it needs Deno runs on
 * Deno and is skipped on Node. The body asserts it is on Deno, so it fails on
 * the lane that must not run it, and passes on the one that must.
 */

import { RuntimeTasks } from "@zuke/core";
import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";

test({
  name: "a denoOnly test runs on Deno and nowhere else",
  denoOnly: "asserts that it runs on Deno",
  fn: () => {
    assertEquals(RuntimeTasks.facts().name, "deno");
  },
});
