// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: two real sweeper processes racing to reap the same abandoned run.
 *
 * The in-process suite can prove a reap happens; it cannot prove that two of
 * them do not both happen. Exactly one process must take the run over, or the
 * work it was owed is performed twice by two processes at once — which is the
 * failure a lease exists to prevent, not merely the duplicate an at-least-once
 * contract tolerates.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../../packages/core/mod.ts";

const FIXTURE = new URL("./fixtures/effect_build.ts", import.meta.url);

/**
 * Run the fixture as a real `deno` subprocess against `dir`.
 *
 * Both streams are returned, because the interesting failure here is a sweeper
 * exiting non-zero and the reason is on stderr — a race that only shows up on a
 * slower runner is unreadable if the diagnosis is thrown away.
 */
async function run(
  args: string[],
  dir: string,
  marker: string,
): Promise<{ code: number; out: string; err: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    // A `file://` URL rather than URL.pathname, which is `/C:/…` on Windows.
    args: ["run", "-A", FIXTURE.href, ...args],
    env: { ZUKE_STATE_DIR: dir, ZUKE_E2E_MARKER: marker },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  const decoder = new TextDecoder();
  return {
    code,
    out: decoder.decode(stdout),
    err: decoder.decode(stderr),
  };
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

Deno.test("two sweepers race an abandoned run; exactly one reaps it", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-e2e-" });
  const marker = `${dir}/marker.log`;
  try {
    // A completed run, which we then rewind to what a killed process leaves.
    assertEquals((await run(["announce"], dir, marker)).code, 0);
    assertEquals(await markerLines(marker), ["announce redriven=false"]);

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const runs = await store.listRuns({});
    assertEquals(runs.length, 1);
    const id = runs[0].id;

    const got = await store.getRun(id);
    if (got === null) throw new Error("the run vanished");
    const stranded = structuredClone(got.record);
    stranded.status = "running";
    stranded.targets["announce"] = {
      status: "running",
      meta: {},
      effects: {
        announce: {
          status: "pending",
          intentAt: "2026-08-10T10:00:00.000Z",
          attempts: 1,
        },
      },
    };
    assertEquals((await store.putRun(stranded, got.version)).ok, true);

    // Two genuinely separate sweepers, at the same time.
    const [a, b] = await Promise.all([
      run(["resume", "--check"], dir, marker),
      run(["resume", "--check"], dir, marker),
    ]);
    // Both sweepers must exit clean. The loser has not failed — it either could
    // not take the lease, or found the run already finished — and a sweep that
    // reported either as a failure would put a false alarm in a cron's exit code.
    assertEquals(
      [a.code, b.code],
      [0, 0],
      `a sweeper exited non-zero: [${a.code}, ${b.code}]\n` +
        `--- a stdout ---\n${a.out}\n--- a stderr ---\n${a.err}\n` +
        `--- b stdout ---\n${b.out}\n--- b stderr ---\n${b.err}`,
    );

    // Driven exactly once more, by exactly one of them. Two would mean both
    // sweepers took the run over, which the lease exists to prevent.
    assertEquals(await markerLines(marker), [
      "announce redriven=false",
      "announce redriven=true",
    ]);

    const after = await store.getRun(id);
    assertEquals(after?.record.status, "succeeded");
    const row = after?.record.targets["announce"]?.effects?.["announce"];
    assertEquals(row?.status, "done");
    assertEquals(row?.attempts, 2);
    // One reap on the record, not two.
    const reaps = (after?.record.events ?? []).filter((e) => e.tool === "reap");
    assertEquals(reaps.length, 1);
  } finally {
    // Best-effort: a cleanup failure must not mask the real assertion error.
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
