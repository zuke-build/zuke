// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for `ConsoleTasks.logo` — console's own behaviour around the wordmark:
 * that it reaches the sink and respects the level.
 *
 * The renderer itself lives in `@zuke/core` and is tested there; console no
 * longer carries a copy of it, so re-testing `logoLines` here would only
 * assert that a dependency works.
 */

import { ConsoleTasks, type Sink } from "../src/console.ts";
import { ZUKE_LOGO } from "@zuke/core";
import { assertEquals } from "../../core/tests/_assert.ts";

Deno.test("ConsoleTasks.logo prints the art through the sink", () => {
  const out: string[] = [];
  const sink: Sink = { out: (l) => out.push(l), err: () => {} };
  ConsoleTasks.configure({ sink, color: false, level: "info" });
  ConsoleTasks.logo({ tagline: "build automation" });
  assertEquals(out, [...ZUKE_LOGO.split("\n"), "build automation"]);
  ConsoleTasks.reset();
});

Deno.test("ConsoleTasks.logo is muted at level silent", () => {
  const out: string[] = [];
  const sink: Sink = { out: (l) => out.push(l), err: () => {} };
  ConsoleTasks.configure({ sink, color: false, level: "silent" });
  ConsoleTasks.logo();
  assertEquals(out, []);
  ConsoleTasks.reset();
});
