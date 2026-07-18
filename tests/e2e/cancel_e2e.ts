/**
 * End-to-end: cross-process cancellation. Process A runs the
 * {@link file://./fixtures/cancel_build.ts} pipeline to its approval gate and
 * suspends, persisting the run. Process B — a genuinely separate `zuke cancel`
 * subprocess — stops it, runs the deploy's compensation (reading the slot the
 * deploy persisted), and settles the record as `cancelled`. Proves the whole
 * flow across real OS processes over a shared temp `ZUKE_STATE_DIR`, the thing
 * the in-process suite cannot. Excluded from the fast unit gate; run by the
 * `integration` target on the OS matrix.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../../packages/core/mod.ts";

const FIXTURE = new URL("./fixtures/cancel_build.ts", import.meta.url);

/** The captured result of one fixture subprocess. */
interface Run {
  code: number;
  out: string;
}

/** Run the cancel fixture as a real `deno` subprocess against state dir `dir`. */
async function runFixture(args: string[], dir: string): Promise<Run> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", FIXTURE.href, ...args],
    env: { ZUKE_STATE_DIR: dir },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout } = await command.output();
  return { code, out: new TextDecoder().decode(stdout) };
}

Deno.test("a separate process cancels a suspended run and runs its compensation", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-e2e-" });
  try {
    // Process 1: run to the gate and suspend, persisting the run.
    const suspend = await runFixture(["promote"], dir);
    assertEquals(suspend.code, 0);
    assertStringIncludes(suspend.out, "DEPLOYED");

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const runs = await store.listRuns({});
    assertEquals(runs.length, 1);
    const id = runs[0].id;
    assertEquals(runs[0].status, "suspended");

    // Process 2: cancel it. The compensation runs, reading the deploy's slot.
    const cancelled = await runFixture(["cancel", id], dir);
    assertEquals(cancelled.code, 0);
    assertStringIncludes(cancelled.out, "ROLLED_BACK:sit-7");
    // The gate never opened, so promote never ran.
    assertEquals(cancelled.out.includes("PROMOTED"), false);

    // The record is durably cancelled.
    const loaded = await store.getRun(id);
    assertEquals(loaded?.record.status, "cancelled");
    assertEquals(loaded?.record.events.some((e) => e.tool === "cancel"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
