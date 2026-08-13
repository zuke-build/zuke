// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: the one thing the in-process suite cannot prove — that an effect's
 * intent survives a real `SIGKILL`, and that a **different** OS process finds it
 * and drives the effect again.
 *
 * The fixture ({@link file://./fixtures/effect_build.ts}) appends a line per
 * drive to a marker file, so the count is observed rather than inferred. This
 * suite is excluded from the fast unit gate and runs on its own OS matrix (see
 * the `integration` target / integration.yml).
 *
 * The reaper is stood in for, because it does not exist yet. It has two
 * observations to make — the owner's lease has lapsed, and the run is stuck
 * `running` — and the parent makes both by hand here. Everything either side of
 * that is real processes and real state, including the fact that a resume
 * *refuses* the run while the dead owner's lease is still live.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../../packages/core/mod.ts";

const FIXTURE = new URL("./fixtures/effect_build.ts", import.meta.url);

/** How long to wait for the child to reach its effect before giving up. */
const REACH_TIMEOUT_MS = 30_000;

/** Spawn the fixture as a real `deno` subprocess against `dir`. */
function spawn(
  args: string[],
  dir: string,
  marker: string,
  hang: boolean,
): Deno.ChildProcess {
  return new Deno.Command(Deno.execPath(), {
    // A `file://` URL rather than URL.pathname, which is `/C:/…` on Windows.
    args: ["run", "-A", FIXTURE.href, ...args],
    env: {
      ZUKE_STATE_DIR: dir,
      ZUKE_E2E_MARKER: marker,
      ...(hang ? { ZUKE_E2E_HANG: "1" } : {}),
    },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}

/** Narrow parsed JSON to an object, so the lock record can be edited without a cast. */
function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object, got ${JSON.stringify(value)}`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) out[key] = val;
  return out;
}

/** The marker file's lines, or an empty list if it does not exist yet. */
async function markerLines(marker: string): Promise<string[]> {
  try {
    const text = await Deno.readTextFile(marker);
    return text.split("\n").filter((line) => line !== "");
  } catch {
    return [];
  }
}

/** Wait until the marker file has `count` lines, or fail after the timeout. */
async function waitForLines(marker: string, count: number): Promise<string[]> {
  const deadline = Date.now() + REACH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const lines = await markerLines(marker);
    if (lines.length >= count) return lines;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `the effect did not reach ${count} line(s) within ${REACH_TIMEOUT_MS}ms`,
  );
}

Deno.test("a SIGKILL mid-effect leaves a durable intent another process re-drives", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-e2e-" });
  const marker = `${dir}/marker.log`;
  try {
    // Process 1: reaches the effect — which appends its line — and then parks.
    const child = spawn(["announce"], dir, marker, true);
    const first = await waitForLines(marker, 1);
    assertEquals(first, ["announce redriven=false"]);

    // Kill it where a pod eviction would: intent committed, effect performed,
    // settlement never written.
    child.kill("SIGKILL");
    await child.status;

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const runs = await store.listRuns({});
    assertEquals(runs.length, 1);
    const id = runs[0].id;

    // What a killed process leaves, read by a different process entirely: the
    // run never finished, and the effect is still recorded as owed.
    const killed = await store.getRun(id);
    if (killed === null) throw new Error("the run vanished");
    assertEquals(killed.record.status, "running");
    const owed = killed.record.targets["announce"]?.effects?.["announce"];
    assertEquals(owed?.status, "pending");
    assertEquals(owed?.attempts, 1);
    assertEquals(owed?.settledAt, undefined);
    const intentAt = owed?.intentAt;
    assertEquals(typeof intentAt, "string");

    // The killed process never released its lease, and a lease outlives its
    // holder by design — so until it lapses, a resume must refuse this run
    // rather than start a second process against it. That refusal is the whole
    // point of holding a lease, so it is asserted rather than worked around.
    const record = structuredClone(killed.record);
    record.status = "suspended";
    assertEquals((await store.putRun(record, killed.version)).ok, true);

    const tooEarly = spawn(["resume", id], dir, marker, false);
    assertEquals((await tooEarly.status).code, 1);
    assertEquals(await markerLines(marker), ["announce redriven=false"]);

    // Now let the lease lapse. Only the clock is moved: the lock record stays
    // exactly as the killed process left it, with its holder and token intact,
    // and only its expiry is backdated. So the resume goes through the store's
    // real expired-lease takeover — the branch that runs in production when a
    // dead holder's claim runs out — rather than the different path a missing
    // lock would take. Waiting out a 60-second TTL is the only alternative, and
    // it would test the same branch a minute later.
    const lockPath = `${dir}/locks/zuke-run-${id}.json`;
    const lock = recordOf(JSON.parse(await Deno.readTextFile(lockPath)));
    assertEquals(typeof lock.token, "string"); // still the dead holder's
    lock.expiresAt = Date.now() - 1;
    await Deno.writeTextFile(lockPath, JSON.stringify(lock));

    // Process 2: a real, separate `resume`. It drives the owed effect again.
    const resumer = spawn(["resume", id], dir, marker, false);
    const status = await resumer.status;
    assertEquals(status.code, 0);

    const lines = await markerLines(marker);
    assertEquals(lines, [
      "announce redriven=false",
      "announce redriven=true",
    ]);

    const settled = await store.getRun(id);
    const row = settled?.record.targets["announce"]?.effects?.["announce"];
    assertEquals(row?.status, "done");
    assertEquals(row?.attempts, 2);
    // The obligation keeps the time it was first owed, across the process
    // boundary — a re-drive does not restart the clock on it.
    assertEquals(row?.intentAt, intentAt);
  } finally {
    // Best-effort: a cleanup failure must not mask the real assertion error.
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
