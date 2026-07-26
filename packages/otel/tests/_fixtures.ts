/**
 * Shared test fixtures: a {@link RunRecord} builder, a {@link TargetRunState}
 * builder, a fixed {@link OtlpResource}, and a capturing {@link OtlpTransport}
 * fake — so the unit tests assert exported payloads without any network.
 */

import type { RunRecord, TargetRunState } from "@zuke/core";
import type {
  OtlpMetricsPayload,
  OtlpResource,
  OtlpTracePayload,
} from "../src/otlp.ts";
import type { OtlpTransport } from "../src/exporter.ts";

/** A fixed resource/scope identity for tests. */
export const RESOURCE: OtlpResource = {
  serviceName: "test-svc",
  attributes: {},
  scopeVersion: "0.0.0",
};

/** Build a {@link TargetRunState} over the `pending`/empty-meta defaults. */
export function target(
  overrides: Partial<TargetRunState> = {},
): TargetRunState {
  return { status: "pending", meta: {}, ...overrides };
}

/** Build a {@link RunRecord} over sensible defaults, overriding any field. */
export function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    build: "MyBuild",
    rootTarget: "deploy",
    status: "running",
    actor: "alice",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:10.000Z",
    graph: [],
    params: {},
    targets: {},
    signals: {},
    events: [],
    ...overrides,
  };
}

/** What a {@link fakeTransport} recorded. */
export interface Captured {
  /** Trace payloads handed to the transport, in order. */
  traces: OtlpTracePayload[];
  /** Metrics payloads handed to the transport, in order. */
  metrics: OtlpMetricsPayload[];
}

/** A capturing {@link OtlpTransport} plus the {@link Captured} record it fills. */
export function fakeTransport(): {
  transport: OtlpTransport;
  captured: Captured;
} {
  const captured: Captured = { traces: [], metrics: [] };
  return {
    captured,
    transport: {
      traces(payload) {
        captured.traces.push(payload);
        return Promise.resolve();
      },
      metrics(payload) {
        captured.metrics.push(payload);
        return Promise.resolve();
      },
    },
  };
}
