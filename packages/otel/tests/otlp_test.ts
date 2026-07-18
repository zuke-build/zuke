import { assertEquals } from "../../core/tests/_assert.ts";
import {
  buildMetrics,
  buildTraces,
  isoToNano,
  type MetricPoint,
  runOutcome,
  type RunSpanIds,
  SCOPE_NAME,
} from "../src/otlp.ts";
import { makeRecord, RESOURCE, target } from "./_fixtures.ts";

const IDS: RunSpanIds = {
  traceId: "0123456789abcdef0123456789abcdef",
  runSpanId: "1111111111111111",
  targetSpanIds: new Map([
    ["lint", "2222222222222222"],
    ["test", "3333333333333333"],
    ["skipped", "4444444444444444"],
  ]),
};

Deno.test("isoToNano converts millisecond timestamps exactly", () => {
  assertEquals(isoToNano("1970-01-01T00:00:00.000Z"), "0");
  assertEquals(isoToNano("1970-01-01T00:00:01.000Z"), "1000000000");
  // Millisecond precision is preserved without float overflow.
  assertEquals(isoToNano("2026-01-01T00:00:00.000Z"), "1767225600000000000");
});

Deno.test("isoToNano returns 0 for an unparseable timestamp", () => {
  assertEquals(isoToNano("not-a-date"), "0");
});

Deno.test("runOutcome maps cancelling to cancelled, else passes through", () => {
  assertEquals(runOutcome("cancelling"), "cancelled");
  assertEquals(runOutcome("cancelled"), "cancelled");
  assertEquals(runOutcome("succeeded"), "succeeded");
  assertEquals(runOutcome("failed"), "failed");
});

Deno.test("buildTraces emits a run span plus one span per executed target", () => {
  const record = makeRecord({
    status: "succeeded",
    targets: {
      lint: target({
        status: "succeeded",
        startedAt: "2026-01-01T00:00:01.000Z",
        endedAt: "2026-01-01T00:00:03.000Z",
      }),
      test: target({
        status: "failed",
        startedAt: "2026-01-01T00:00:03.000Z",
        endedAt: "2026-01-01T00:00:05.000Z",
        error: "1 test failed",
      }),
      // No startedAt → never ran → no span.
      skipped: target({ status: "skipped" }),
    },
  });

  const payload = buildTraces(record, IDS, RESOURCE);
  const { resource, scopeSpans } = payload.resourceSpans[0];
  assertEquals(
    resource.attributes[0],
    { key: "service.name", value: { stringValue: "test-svc" } },
  );
  const scope = scopeSpans[0].scope;
  assertEquals(scope.name, SCOPE_NAME);

  const spans = scopeSpans[0].spans;
  assertEquals(spans.length, 3); // run + lint + test (skipped omitted)

  const run = spans[0];
  assertEquals(run.name, "MyBuild");
  assertEquals(run.spanId, IDS.runSpanId);
  assertEquals(run.parentSpanId, undefined);
  assertEquals(run.traceId, IDS.traceId);
  assertEquals(run.startTimeUnixNano, isoToNano("2026-01-01T00:00:00.000Z"));
  assertEquals(run.endTimeUnixNano, isoToNano("2026-01-01T00:00:10.000Z"));

  const lint = spans[1];
  assertEquals(lint.name, "lint");
  assertEquals(lint.spanId, "2222222222222222");
  assertEquals(lint.parentSpanId, IDS.runSpanId);
  assertEquals(lint.status.code, 0); // ok/unset

  const test = spans[2];
  assertEquals(test.name, "test");
  assertEquals(test.status.code, 2); // error
  assertEquals(test.status.message, "1 test failed");
});

Deno.test("buildTraces marks a failed run span as error", () => {
  const record = makeRecord({ status: "failed" });
  const run = buildTraces(record, IDS, RESOURCE).resourceSpans[0]
    .scopeSpans[0].spans[0];
  assertEquals(run.status.code, 2);
  assertEquals(run.status.message, "run failed");
});

Deno.test("buildTraces marks a cancelling run span as cancelled error", () => {
  const record = makeRecord({ status: "cancelling" });
  const run = buildTraces(record, IDS, RESOURCE).resourceSpans[0]
    .scopeSpans[0].spans[0];
  assertEquals(run.status.code, 2);
  assertEquals(run.status.message, "run cancelled");
});

Deno.test("buildTraces omits a started target with no span id and defaults a missing end", () => {
  const ids: RunSpanIds = {
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runSpanId: "bbbbbbbbbbbbbbbb",
    targetSpanIds: new Map([["running", "cccccccccccccccc"]]),
  };
  const record = makeRecord({
    status: "succeeded",
    targets: {
      // Started, still running (no endedAt) → span ends where it started.
      running: target({
        status: "running",
        startedAt: "2026-01-01T00:00:01.000Z",
      }),
      // Ran, but absent from the id map → no span emitted.
      orphan: target({
        status: "succeeded",
        startedAt: "2026-01-01T00:00:02.000Z",
      }),
    },
  });
  const spans = buildTraces(record, ids, RESOURCE).resourceSpans[0]
    .scopeSpans[0].spans;
  assertEquals(spans.map((s) => s.name).sort(), ["MyBuild", "running"]);
  const runningSpan = spans.find((s) => s.name === "running");
  assertEquals(
    runningSpan?.endTimeUnixNano,
    runningSpan?.startTimeUnixNano,
  );
});

Deno.test("buildMetrics renders a delta Sum data point per point", () => {
  const points: MetricPoint[] = [{
    name: "zuke.runs",
    unit: "1",
    value: 1,
    attributes: { outcome: "succeeded", "zuke.build": "MyBuild" },
    startIso: "2026-01-01T00:00:00.000Z",
    atIso: "2026-01-01T00:00:10.000Z",
  }];
  const payload = buildMetrics(points, RESOURCE);
  const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
  assertEquals(metrics.length, 1);
  const metric = metrics[0];
  assertEquals(metric.name, "zuke.runs");
  assertEquals(metric.unit, "1");
  assertEquals(metric.sum.aggregationTemporality, 1); // delta
  assertEquals(metric.sum.isMonotonic, true);
  const dp = metric.sum.dataPoints[0];
  assertEquals(dp.asInt, "1");
  assertEquals(dp.timeUnixNano, isoToNano("2026-01-01T00:00:10.000Z"));
  assertEquals(dp.attributes, [
    { key: "outcome", value: { stringValue: "succeeded" } },
    { key: "zuke.build", value: { stringValue: "MyBuild" } },
  ]);
});
