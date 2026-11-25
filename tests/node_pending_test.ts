// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The list of test files the Node lane skips until they are ported
 * (`tests/node_pending.json`, read by `vitest.config.ts`): every entry must
 * still be a test file, listed once and in order, so a renamed or deleted
 * file cannot leave a stale entry behind.
 */

import { FileTasks } from "@zuke/core";
import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";

test("every file the Node lane skips is a test file, listed once and in order", async () => {
  const pending: unknown = await FileTasks.readJson("tests/node_pending.json");
  const entries = Array.isArray(pending) ? pending.map(String) : [];
  assertEquals(entries.length > 0, true);
  assertEquals(entries, [...new Set(entries)].sort());
  for (const entry of entries) {
    assertEquals(entry.endsWith("_test.ts"), true, entry);
    assertEquals((await FileTasks.stat(entry)).isFile, true, entry);
  }
});
