/**
 * End-to-end: cross-process trace continuity. Process A runs the
 * {@link file://./fixtures/otel_build.ts} pipeline to its approval gate and
 * suspends; process B — a genuinely separate `resume` subprocess — delivers the
 * signal and finishes it. The `@zuke/otel` plugin in each process exports to a
 * shared capture file, and the test proves that:
 *
 * - process A exports `zuke.run.started` (a fresh run) and no trace;
 * - process B exports the run's **complete** trace exactly once, carrying the
 *   `deploy` span (which ran in process A) *and* the `promote` span (process B),
 *   because the durable record accumulates every target's absolute timings; and
 * - that trace's id is the deterministic hash of the run id — the same id both
 *   processes would derive, so their telemetry joins one trace with no handoff.
 *
 * Excluded from the fast unit gate (`*_e2e.ts`); run by the `integration` target.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../../packages/core/mod.ts";
import { traceIdFor } from "../../packages/otel/src/ids.ts";

const FIXTURE = new URL("./fixtures/otel_build.ts", import.meta.url);

/** The captured result of one fixture subprocess. */
interface Run {
  code: number;
  out: string;
}

/** Run the OTel fixture as a real `deno` subprocess against `dir` + capture file. */
async function runFixture(
  args: string[],
  dir: string,
  captureFile: string,
): Promise<Run> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", FIXTURE.href, ...args],
    env: { ZUKE_STATE_DIR: dir, OTEL_CAPTURE_FILE: captureFile },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout } = await command.output();
  return { code, out: new TextDecoder().decode(stdout) };
}

/** Parse the capture file into `{ url, payload }` records (one per exported POST). */
async function readCaptured(
  file: string,
): Promise<{ url: string; payload: unknown }[]> {
  const text = await Deno.readTextFile(file);
  return text.split("\n").filter((l) => l !== "").map((line) => {
    const record = JSON.parse(line);
    return { url: record.url, payload: JSON.parse(record.body) };
  });
}

Deno.test("two processes export one complete trace under a shared trace id", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-otel-e2e-" });
  const captureFile = `${dir}/otlp.ndjson`;
  await Deno.writeTextFile(captureFile, "");
  try {
    // Process A: run to the gate and suspend.
    const suspend = await runFixture(["promote"], dir, captureFile);
    assertEquals(suspend.code, 0);
    assertEquals(suspend.out.includes("DEPLOYED"), true);
    assertEquals(suspend.out.includes("PROMOTED"), false);

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const runs = await store.listRuns({});
    assertEquals(runs.length, 1);
    const id = runs[0].id;
    assertEquals(runs[0].status, "suspended");

    // After process A: a started counter and a suspended counter, but no trace.
    const afterA = await readCaptured(captureFile);
    assertEquals(afterA.some((r) => r.url.endsWith("/v1/traces")), false);
    assertEquals(
      afterA.filter((r) => r.url.endsWith("/v1/metrics")).length >= 1,
      true,
    );

    // Process B: deliver the signal and finish.
    const resumed = await runFixture(
      ["resume", id, "--signal", "approved"],
      dir,
      captureFile,
    );
    assertEquals(resumed.code, 0);
    assertEquals(resumed.out.includes("PROMOTED"), true);
    assertEquals(
      await store.getRun(id).then((g) => g?.record.status),
      "succeeded",
    );

    const all = await readCaptured(captureFile);
    const traces = all.filter((r) => r.url.endsWith("/v1/traces"));
    // Exactly one trace, exported by the finishing process.
    assertEquals(traces.length, 1);

    const payload = traces[0].payload as {
      resourceSpans: [{
        scopeSpans: [{
          spans: {
            name: string;
            traceId: string;
            startTimeUnixNano: string;
          }[];
        }];
      }];
    };
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    const names = spans.map((s) => s.name).sort();
    // The trace spans both processes: deploy (process A) and promote (process B).
    assertEquals(names, ["Cd", "deploy", "promote"]);

    // The trace id is the deterministic hash of the run id.
    assertEquals(spans[0].traceId, await traceIdFor(id));

    // deploy (process A) started strictly before promote (process B) — real gap.
    const deploy = spans.find((s) => s.name === "deploy");
    const promote = spans.find((s) => s.name === "promote");
    assertEquals(
      BigInt(deploy?.startTimeUnixNano ?? "0") <
        BigInt(promote?.startTimeUnixNano ?? "0"),
      true,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
