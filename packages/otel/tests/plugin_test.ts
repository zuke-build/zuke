import { assertEquals } from "../../core/tests/_assert.ts";
import type { Plugin, RunRecord } from "@zuke/core";
import { createOtelPlugin, DEDUP_CAP, otel, otelWith } from "../src/plugin.ts";
import type { OtlpTransport } from "../src/exporter.ts";
import { fakeTransport, makeRecord, RESOURCE, target } from "./_fixtures.ts";

/** Deliver a record to the plugin's `onRunStateChange`, failing if it has none. */
async function deliver(plugin: Plugin, record: RunRecord): Promise<void> {
  const hook = plugin.onRunStateChange;
  if (hook === undefined) throw new Error("plugin has no onRunStateChange");
  await hook(record);
}

/** The metric names inside a captured metrics payload. */
function metricNames(payload: {
  resourceMetrics: [{ scopeMetrics: [{ metrics: { name: string }[] }] }];
}): string[] {
  return payload.resourceMetrics[0].scopeMetrics[0].metrics.map((m) => m.name);
}

Deno.test("a fresh running record emits zuke.run.started only", async () => {
  const { transport, captured } = fakeTransport();
  const plugin = createOtelPlugin(transport, RESOURCE);
  await deliver(
    plugin,
    makeRecord({ status: "running", targets: { lint: target() } }),
  );
  assertEquals(captured.traces.length, 0);
  assertEquals(captured.metrics.length, 1);
  assertEquals(metricNames(captured.metrics[0]), ["zuke.run.started"]);
});

Deno.test("a resumed running record emits nothing (not a fresh start)", async () => {
  const { transport, captured } = fakeTransport();
  const plugin = createOtelPlugin(transport, RESOURCE);
  await deliver(
    plugin,
    makeRecord({
      status: "running",
      targets: {
        lint: target({
          status: "succeeded",
          startedAt: "2026-01-01T00:00:01.000Z",
        }),
        test: target({ status: "pending" }),
      },
    }),
  );
  assertEquals(captured.metrics.length, 0);
  assertEquals(captured.traces.length, 0);
});

Deno.test("a suspended record emits zuke.run.suspended per waiting target", async () => {
  const { transport, captured } = fakeTransport();
  const plugin = createOtelPlugin(transport, RESOURCE);
  await deliver(
    plugin,
    makeRecord({
      status: "suspended",
      targets: {
        approve: target({
          status: "waiting",
          waitingFor: { trigger: "signal:approved", onTimeout: "fail" },
        }),
      },
    }),
  );
  assertEquals(captured.traces.length, 0);
  assertEquals(metricNames(captured.metrics[0]), ["zuke.run.suspended"]);
  const dp = captured.metrics[0].resourceMetrics[0].scopeMetrics[0].metrics[0]
    .sum.dataPoints[0];
  assertEquals(
    dp.attributes.find((a) => a.key === "trigger")?.value.stringValue,
    "signal:approved",
  );
});

Deno.test("suspended emits only for waiting targets, defaulting an unknown trigger", async () => {
  const { transport, captured } = fakeTransport();
  const plugin = createOtelPlugin(transport, RESOURCE);
  await deliver(
    plugin,
    makeRecord({
      status: "suspended",
      targets: {
        done: target({
          status: "succeeded",
          startedAt: "2026-01-01T00:00:01.000Z",
        }),
        // A waiting target with no waitingFor → trigger falls back to "unknown".
        gate: target({ status: "waiting" }),
      },
    }),
  );
  const metrics =
    captured.metrics[0].resourceMetrics[0].scopeMetrics[0].metrics;
  assertEquals(metrics.length, 1); // only the waiting target, not `done`
  const trigger = metrics[0].sum.dataPoints[0].attributes.find(
    (a) => a.key === "trigger",
  );
  assertEquals(trigger?.value.stringValue, "unknown");
});

Deno.test("a terminal record emits one trace and a zuke.runs metric", async () => {
  const { transport, captured } = fakeTransport();
  const plugin = createOtelPlugin(transport, RESOURCE);
  await deliver(
    plugin,
    makeRecord({
      status: "succeeded",
      targets: {
        lint: target({
          status: "succeeded",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:02.000Z",
        }),
      },
    }),
  );
  assertEquals(captured.traces.length, 1);
  assertEquals(metricNames(captured.metrics[0]), ["zuke.runs"]);
});

Deno.test("cancelling then cancelled exports the trace exactly once", async () => {
  const { transport, captured } = fakeTransport();
  const plugin = createOtelPlugin(transport, RESOURCE);
  // In-process cancel drives running → cancelling → cancelled; the plugin must
  // not double-export.
  await deliver(plugin, makeRecord({ status: "cancelling" }));
  await deliver(plugin, makeRecord({ status: "cancelled" }));
  assertEquals(captured.traces.length, 1);
  assertEquals(captured.metrics.length, 1);
  const outcome = captured.metrics[0].resourceMetrics[0].scopeMetrics[0]
    .metrics[0].sum.dataPoints[0].attributes.find((a) => a.key === "outcome");
  assertEquals(outcome?.value.stringValue, "cancelled");
});

Deno.test("otelWith is inert when no endpoint resolves", () => {
  const plugin = otelWith(undefined, { readEnv: () => undefined });
  assertEquals(plugin.name, "otel");
  assertEquals(plugin.onRunStateChange, undefined);
});

Deno.test("terminal traces and metrics are exported concurrently", async () => {
  // traces() resolves only once metrics() has been entered. Serial
  // (await traces; await metrics) would deadlock; Promise.all completes.
  let metricsEntered = false;
  let releaseTraces: () => void = () => {};
  const tracesGate = new Promise<void>((resolve) => {
    releaseTraces = resolve;
  });
  const transport: OtlpTransport = {
    traces: () => tracesGate,
    metrics: () => {
      metricsEntered = true;
      releaseTraces();
      return Promise.resolve();
    },
  };
  const plugin = createOtelPlugin(transport, RESOURCE);
  await deliver(plugin, makeRecord({ status: "succeeded" }));
  assertEquals(metricsEntered, true);
});

Deno.test("the dedup set is bounded — old run ids are evicted", async () => {
  const { transport, captured } = fakeTransport();
  const plugin = createOtelPlugin(transport, RESOURCE);
  // Deliver DEDUP_CAP + 1 distinct terminal runs; each emits once, and the
  // oldest (run-0) is evicted when the set overflows.
  for (let i = 0; i <= DEDUP_CAP; i++) {
    await deliver(plugin, makeRecord({ id: `run-${i}`, status: "succeeded" }));
  }
  const afterFill = captured.traces.length;
  assertEquals(afterFill, DEDUP_CAP + 1);
  // run-0 was evicted → re-delivering it re-emits (bounded, not leaking).
  await deliver(plugin, makeRecord({ id: "run-0", status: "succeeded" }));
  assertEquals(captured.traces.length, afterFill + 1);
  // A still-remembered run is NOT re-emitted.
  await deliver(
    plugin,
    makeRecord({ id: `run-${DEDUP_CAP}`, status: "succeeded" }),
  );
  assertEquals(captured.traces.length, afterFill + 1);
});

Deno.test("otel() reads the environment and is inert with no endpoint", () => {
  // Exercises the public factory and its default `Deno.env.get` reader; clear
  // the OTLP endpoint vars so the assertion holds regardless of the host env.
  const keys = [
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  ];
  const saved = keys.map((k) => [k, Deno.env.get(k)] as const);
  for (const k of keys) Deno.env.delete(k);
  try {
    assertEquals(otel().onRunStateChange, undefined);
  } finally {
    for (const [k, v] of saved) if (v !== undefined) Deno.env.set(k, v);
  }
});

Deno.test("otelWith wires settings through to the transport", async () => {
  const { transport, captured } = fakeTransport();
  const plugin = otelWith((s) => s.endpoint("http://h:4318"), {
    transport,
    readEnv: () => undefined,
  });
  await deliver(plugin, makeRecord({ status: "succeeded" }));
  assertEquals(captured.traces.length, 1);
});
