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
 * One seam is stood in for: moving an abandoned `running` run back to
 * `suspended` is the reaper's job, and the reaper does not exist yet. Here the
 * parent does that single transition by hand, and says so — everything either
 * side of it is real processes and real state.
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

    // The reaper's one transition, by hand until it exists: an abandoned
    // `running` run becomes resumable.
    const record = structuredClone(killed.record);
    record.status = "suspended";
    const moved = await store.putRun(record, killed.version);
    assertEquals(moved.ok, true);

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
