// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: a durable canary across real processes. The process that staged
 * the candidate exits when the run parks at its bake; with nobody alive the
 * bake keeps its clock, a too-early `resume --check` leaves it parked, and a
 * later one — another process again — runs the final analysis and promotes the
 * candidate the first process staged, or rolls it back to the stable version
 * the first process recorded.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../../packages/core/mod.ts";
import { runFixture } from "./_harness.ts";

const FIXTURE = new URL("./fixtures/canary_build.ts", import.meta.url);

/** The bake the fixture runs with: long enough to resume too early once. */
const BAKE_MS = 3_000;

/** A fresh state dir and log, and the env that points the fixture at them. */
async function sandbox(): Promise<
  { dir: string; logFile: string; env: Record<string, string> }
> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-canary-e2e-" });
  const logFile = `${dir}/calls.log`;
  return {
    dir,
    logFile,
    env: {
      ZUKE_STATE_DIR: `${dir}/runs`,
      ZUKE_E2E_CANARY_LOG: logFile,
      ZUKE_E2E_CANARY_BAKE: `${BAKE_MS}ms`,
    },
  };
}

/** The logged calls, one per line. */
async function calls(logFile: string): Promise<string[]> {
  const text = await Deno.readTextFile(logFile);
  return text.split("\n").filter((line) => line !== "");
}

/** The status of the only run under `dir`. */
async function status(dir: string): Promise<string> {
  const runs = await new FileSystemStateStore(`${dir}/runs`, defaultStateHost)
    .listRuns({});
  assertEquals(runs.length, 1);
  return runs[0].status;
}

Deno.test("a durable canary parks at its bake and a later process promotes it", async () => {
  const { dir, logFile, env } = await sandbox();
  try {
    const started = Date.now();
    const first = await runFixture(FIXTURE, ["ship"], env);
    assertEquals(first.code, 0, first.err);
    assertEquals(await status(dir), "suspended");
    const staged = await calls(logFile);
    assertEquals(staged.length, 2, staged.join("\n"));
    const candidate = staged[1].split(" ")[2];

    // Too early, if this process starts inside the bake: still parked.
    if (Date.now() - started < BAKE_MS - 500) {
      const early = await runFixture(FIXTURE, ["resume", "--check"], env);
      assertEquals(early.code, 0, early.err);
      assertEquals(await status(dir), "suspended");
    }

    await new Promise((r) => setTimeout(r, BAKE_MS));
    const later = await runFixture(FIXTURE, ["resume", "--check"], env);
    assertEquals(later.code, 0, later.err);
    assertEquals(await status(dir), "succeeded");
    assertEquals(await calls(logFile), [
      "stage",
      `expose 25 ${candidate}`,
      "analyse 25",
      `promote ${candidate}`,
      "shipped",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a durable canary that fails its final analysis rolls back in the later process", async () => {
  const { dir, logFile, env } = await sandbox();
  try {
    const first = await runFixture(FIXTURE, ["ship"], env);
    assertEquals(first.code, 0, first.err);
    await new Promise((r) => setTimeout(r, BAKE_MS));
    const later = await runFixture(FIXTURE, ["resume", "--check"], {
      ...env,
      ZUKE_E2E_CANARY_UNHEALTHY: "1",
    });
    assertEquals(later.code, 1, later.out);
    assertEquals(await status(dir), "cancelled");
    const logged = await calls(logFile);
    assertEquals(logged.slice(-2), ["analyse 25", "abort rev-1"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
