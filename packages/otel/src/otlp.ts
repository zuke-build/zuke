/**
 * Pure builders that turn a Zuke {@link RunRecord} into OTLP/HTTP **JSON**
 * payloads — one for the trace signal (`resourceSpans`) and one for metrics
 * (`resourceMetrics`). No I/O and no clock: everything is derived from the
 * record's own ISO-8601 timestamps, so the same record always yields the same
 * bytes and the functions are trivially unit-testable. The transport
 * ({@link "./exporter.ts".OtlpHttpExporter}) POSTs whatever these return.
 *
 * Only the small slice of the OTLP JSON schema this exporter actually emits is
 * modelled here (string/int/bool attribute values, `Sum` metrics); the shapes
 * mirror the [OTLP JSON encoding](https://opentelemetry.io/docs/specs/otlp/).
 *
 * @module
 */

import type { RunRecord, TargetRunState } from "@zuke/core";

/** An OTLP `AnyValue` — only the kinds this exporter emits. */
export interface OtlpAnyValue {
  /** A string attribute value. */
  stringValue?: string;
  /** An integer attribute value (uint64/int64 encoded as a decimal string). */
  intValue?: string;
  /** A boolean attribute value. */
  boolValue?: boolean;
}

/** An OTLP key/value attribute. */
export interface OtlpAttribute {
  /** The attribute key. */
  key: string;
  /** The attribute value. */
  value: OtlpAnyValue;
}

/** An OTLP `Status` on a span (`code` 0 unset, 1 ok, 2 error). */
export interface OtlpStatus {
  /** The status code: 0 = unset, 1 = ok, 2 = error. */
  code: number;
  /** A human-readable error message (present only for an error status). */
  message?: string;
}

/** An OTLP span (a run's root span or one of its target spans). */
export interface OtlpSpan {
  /** The trace id (16-byte hex). */
  traceId: string;
  /** This span's id (8-byte hex). */
  spanId: string;
  /** The parent span's id (omitted on a root span). */
  parentSpanId?: string;
  /** The span name (the target's dotted name, or the build name for a run). */
  name: string;
  /** The span kind — always 1 (internal) for a build's spans. */
  kind: number;
  /** Start time, nanoseconds since the Unix epoch, as a decimal string. */
  startTimeUnixNano: string;
  /** End time, nanoseconds since the Unix epoch, as a decimal string. */
  endTimeUnixNano: string;
  /** The span's attributes. */
  attributes: OtlpAttribute[];
  /** The span's status. */
  status: OtlpStatus;
}

/** The instrumentation scope stamped on every emitted span and metric. */
export interface OtlpScope {
  /** The scope name (`@zuke/otel`). */
  name: string;
  /** The scope version (the plugin's package version). */
  version: string;
}

/** An OTLP `NumberDataPoint` of a `Sum` metric. */
export interface OtlpNumberDataPoint {
  /** The point's attributes (the metric's label set). */
  attributes: OtlpAttribute[];
  /** The series' start time, nanoseconds since the epoch, as a string. */
  startTimeUnixNano: string;
  /** The point's time, nanoseconds since the epoch, as a string. */
  timeUnixNano: string;
  /** The integer value (a delta increment), as a decimal string. */
  asInt: string;
}

/** An OTLP `Sum` metric (a monotonic delta counter). */
export interface OtlpSum {
  /** The metric name (e.g. `zuke.runs`). */
  name: string;
  /** The unit (`1` for a dimensionless count, `ms` for a duration). */
  unit: string;
  /** The `Sum` body. */
  sum: {
    /** The metric's data points. */
    dataPoints: OtlpNumberDataPoint[];
    /** Temporality: 1 = delta (each export is an increment). */
    aggregationTemporality: number;
    /** Whether the counter only ever increases. */
    isMonotonic: boolean;
  };
}

/** The top-level OTLP trace-export payload (`POST /v1/traces` body). */
export interface OtlpTracePayload {
  /** The resource-scoped spans (a single resource per export). */
  resourceSpans: [{
    /** The resource these spans describe (its `service.name`, etc.). */
    resource: { attributes: OtlpAttribute[] };
    /** The scope-grouped spans. */
    scopeSpans: [{ scope: OtlpScope; spans: OtlpSpan[] }];
  }];
}

/** The top-level OTLP metrics-export payload (`POST /v1/metrics` body). */
export interface OtlpMetricsPayload {
  /** The resource-scoped metrics (a single resource per export). */
  resourceMetrics: [{
    /** The resource these metrics describe. */
    resource: { attributes: OtlpAttribute[] };
    /** The scope-grouped metrics. */
    scopeMetrics: [{ scope: OtlpScope; metrics: OtlpSum[] }];
  }];
}

/** The pre-computed span ids for a run — its root span plus one per target. */
export interface RunSpanIds {
  /** The run's trace id (16-byte hex). */
  traceId: string;
  /** The run's root span id (8-byte hex). */
  runSpanId: string;
  /** Each target's span id, keyed by dotted target name. */
  targetSpanIds: ReadonlyMap<string, string>;
}

/** The resource/scope identity shared by every export from one plugin. */
export interface OtlpResource {
  /** The `service.name` stamped on the OTLP resource. */
  serviceName: string;
  /** Extra resource attributes (e.g. `deployment.environment`). */
  attributes: Record<string, string>;
  /** The scope version (the plugin package's version). */
  scopeVersion: string;
}

/** One counter increment to render as an OTLP `Sum` data point. */
export interface MetricPoint {
  /** The metric name (e.g. `zuke.runs`). */
  name: string;
  /** The unit (`1` for a count). */
  unit: string;
  /** The increment (usually 1). */
  value: number;
  /** The point's label set. */
  attributes: Record<string, string>;
  /** ISO-8601 series start (the run's `createdAt`). */
  startIso: string;
  /** ISO-8601 event time (the record's `updatedAt`). */
  atIso: string;
}

/** The instrumentation scope name for every span and metric this package emits. */
export const SCOPE_NAME = "@zuke/otel";

/** Convert an ISO-8601 timestamp to nanoseconds-since-epoch (a decimal string). */
export function isoToNano(iso: string): string {
  const ms = Date.parse(iso);
  // Millisecond precision times 1e6 overflows Number.MAX_SAFE_INTEGER, so widen
  // to BigInt for an exact nanosecond value. A malformed timestamp → "0".
  if (Number.isNaN(ms)) return "0";
  return (BigInt(ms) * 1_000_000n).toString();
}

/** Encode a string→string map as OTLP attributes, in insertion order. */
function attributes(map: Record<string, string>): OtlpAttribute[] {
  return Object.entries(map).map(([key, value]) => ({
    key,
    value: { stringValue: value },
  }));
}

/** The OTLP resource for an export (its `service.name` plus extra attributes). */
function resource(res: OtlpResource): { attributes: OtlpAttribute[] } {
  return {
    attributes: attributes({
      "service.name": res.serviceName,
      ...res.attributes,
    }),
  };
}

/** The instrumentation scope for an export. */
function scope(res: OtlpResource): OtlpScope {
  return { name: SCOPE_NAME, version: res.scopeVersion };
}

/** Map a run's terminal status to the outcome label used on spans/metrics. */
export function runOutcome(status: RunRecord["status"]): string {
  // A process that only observes `cancelling` (another process owns the final
  // `cancelled`) still reports the run as cancelled from its own vantage point.
  return status === "cancelling" ? "cancelled" : status;
}

/** The span for one target, or `null` when it never ran (no start timestamp). */
function targetSpan(
  runId: string,
  name: string,
  state: TargetRunState,
  ids: RunSpanIds,
): OtlpSpan | null {
  const startedAt = state.startedAt;
  if (startedAt === undefined) return null; // pending/skipped/waiting — no span
  const spanId = ids.targetSpanIds.get(name);
  if (spanId === undefined) return null;
  const endedAt = state.endedAt ?? startedAt;
  const status: OtlpStatus = state.status === "failed"
    ? { code: 2, message: state.error ?? "target failed" }
    : { code: 0 };
  return {
    traceId: ids.traceId,
    spanId,
    parentSpanId: ids.runSpanId,
    name,
    kind: 1,
    startTimeUnixNano: isoToNano(startedAt),
    endTimeUnixNano: isoToNano(endedAt),
    attributes: attributes({
      "zuke.run.id": runId,
      "zuke.target": name,
      "zuke.target.status": state.status,
    }),
    status,
  };
}

/**
 * Build the OTLP trace payload for a settled run: one root span covering the
 * whole run (`createdAt` → `updatedAt`, which spans any suspend/resume gap) and
 * one child span per target that executed. The record carries every target's
 * absolute timestamps — including targets that ran before a suspend — so a
 * single export from the finishing process is a complete trace.
 */
export function buildTraces(
  record: RunRecord,
  ids: RunSpanIds,
  res: OtlpResource,
): OtlpTracePayload {
  const runFailed = record.status === "failed";
  const runCancelled = runOutcome(record.status) === "cancelled";
  const runStatus: OtlpStatus = runFailed || runCancelled
    ? { code: 2, message: runFailed ? "run failed" : "run cancelled" }
    : { code: 0 };
  const runSpan: OtlpSpan = {
    traceId: ids.traceId,
    spanId: ids.runSpanId,
    name: record.build,
    kind: 1,
    startTimeUnixNano: isoToNano(record.createdAt),
    endTimeUnixNano: isoToNano(record.updatedAt),
    attributes: attributes({
      "zuke.run.id": record.id,
      "zuke.build": record.build,
      "zuke.root_target": record.rootTarget,
      "zuke.actor": record.actor,
      "zuke.run.status": record.status,
    }),
    status: runStatus,
  };
  const spans: OtlpSpan[] = [runSpan];
  for (const [name, state] of Object.entries(record.targets)) {
    const span = targetSpan(record.id, name, state, ids);
    if (span !== null) spans.push(span);
  }
  return {
    resourceSpans: [{
      resource: resource(res),
      scopeSpans: [{ scope: scope(res), spans }],
    }],
  };
}

/** Build an OTLP metrics payload from a set of counter increments. */
export function buildMetrics(
  points: MetricPoint[],
  res: OtlpResource,
): OtlpMetricsPayload {
  const metrics: OtlpSum[] = points.map((p) => ({
    name: p.name,
    unit: p.unit,
    sum: {
      dataPoints: [{
        attributes: attributes(p.attributes),
        startTimeUnixNano: isoToNano(p.startIso),
        timeUnixNano: isoToNano(p.atIso),
        asInt: String(Math.trunc(p.value)),
      }],
      aggregationTemporality: 1, // delta: each export is an increment
      isMonotonic: true,
    },
  }));
  return {
    resourceMetrics: [{
      resource: resource(res),
      scopeMetrics: [{ scope: scope(res), metrics }],
    }],
  };
}
