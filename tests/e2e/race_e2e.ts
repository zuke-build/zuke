// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: the one thing the in-process suite cannot prove — that two real,
 * separate OS processes racing to resume the same suspended run resolve to
 * exactly one winner (the framework's compare-and-swap), not two. Runs the
 * {@link file://./fixtures/gate_build.ts} build as `deno` subprocesses over a
 * shared temp `ZUKE_STATE_DIR`. This suite is excluded from the fast unit gate
 * and runs on its own OS matrix (see the `integration` target / integration.yml)
 * where Windows filesystem-lock semantics get real coverage.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../../packages/core/mod.ts";
import { runFixture } from "./_harness.ts";

const FIXTURE = new URL("./fixtures/gate_build.ts", import.meta.url);

Deno.test("two real processes resume the same run; exactly one wins", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-e2e-" });
  try {
    // Process 1: run to the gate and suspend, persisting the run.
    const suspend = await runFixture(FIXTURE, ["promote"], {
      ZUKE_STATE_DIR: dir,
    });
    assertEquals(suspend.code, 0);
    assertStringIncludes(suspend.out, "DEPLOYED");

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const runs = await store.listRuns({});
    assertEquals(runs.length, 1);
    const id = runs[0].id;

    // Processes 2 and 3: resume the same run concurrently.
    const [a, b] = await Promise.all([
      runFixture(FIXTURE, ["resume", id, "--signal", "approved"], {
        ZUKE_STATE_DIR: dir,
      }),
      runFixture(FIXTURE, ["resume", id, "--signal", "approved"], {
        ZUKE_STATE_DIR: dir,
      }),
    ]);

    // Exactly one process wins the compare-and-swap (exit 0) and promotes;
    // the other loses the race and exits non-zero without promoting.
    assertEquals([a.code, b.code].sort(), [0, 1]);
    const promotions = [a.out, b.out].filter((o) => o.includes("PROMOTED"));
    assertEquals(promotions.length, 1);
  } finally {
    // Best-effort: a cleanup failure must not mask the real assertion error.
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
