/**
 * The {@link otel} plugin factory and its emission logic. The plugin observes a
 * build through one hook — `onRunStateChange`, delivered the run's durable
 * {@link RunRecord} at each run-level transition — and turns those records into
 * OTLP exports:
 *
 * - **`running`** (a *fresh* start only, not a resume): a `zuke.run.started`
 *   counter.
 * - **`suspended`** (parked at a `.waitsFor(...)` gate): a `zuke.run.suspended`
 *   counter per waiting target, tagged with its trigger.
 * - **terminal** (`succeeded` / `failed` / `cancelled`, or `cancelling` when
 *   another process owns the final settle): the complete trace — a run span plus
 *   one span per target that executed — and a `zuke.runs` counter tagged with the
 *   outcome. The record accumulates every target's absolute timings across a
 *   suspend/resume, so this single export is a whole, gap-spanning trace, and the
 *   trace id is derived from the run id so it is the *same* trace the pre-suspend
 *   process would have produced.
 *
 * A run is exported **once**: the emitted-run set guards against the in-process
 * cancel sequence (`cancelling` then `cancelled`) double-emitting. The hook only
 * fires when a state store is configured, so a store-less build produces no
 * telemetry — which is the intended scope (durable/CI runs are the target).
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import type { Plugin, RunRecord } from "@zuke/core";
import { spanIdFor, traceIdFor } from "./ids.ts";
import {
  buildMetrics,
  buildTraces,
  type MetricPoint,
  type OtlpResource,
  runOutcome,
  type RunSpanIds,
} from "./otlp.ts";
import { OtlpHttpExporter, type OtlpTransport } from "./exporter.ts";
import { OtelSettings, resolveOtel } from "./settings.ts";

/**
 * Whether a `running` record is a *fresh* start rather than a resume — true when
 * no target has progressed past `pending` yet (a resumed run's record already
 * carries the targets it settled before suspending).
 */
function isFreshStart(record: RunRecord): boolean {
  for (const state of Object.values(record.targets)) {
    if (state.status !== "pending") return false;
  }
  return true;
}

/** Derive the trace id, run span id, and each target's span id for a record. */
async function runSpanIds(record: RunRecord): Promise<RunSpanIds> {
  const runId = record.id;
  const traceId = await traceIdFor(runId);
  const runSpanId = await spanIdFor(runId, "run");
  const targetSpanIds = new Map<string, string>();
  for (const name of Object.keys(record.targets)) {
    targetSpanIds.set(name, await spanIdFor(runId, name));
  }
  return { traceId, runSpanId, targetSpanIds };
}

/** The `zuke.run.started` counter increment for a fresh run. */
function startedPoint(record: RunRecord): MetricPoint {
  return {
    name: "zuke.run.started",
    unit: "1",
    value: 1,
    attributes: {
      "zuke.build": record.build,
      "zuke.root_target": record.rootTarget,
    },
    startIso: record.createdAt,
    atIso: record.updatedAt,
  };
}

/** The `zuke.runs` counter increment for a settled run, tagged by outcome. */
function outcomePoint(record: RunRecord): MetricPoint {
  return {
    name: "zuke.runs",
    unit: "1",
    value: 1,
    attributes: {
      outcome: runOutcome(record.status),
      "zuke.build": record.build,
      "zuke.root_target": record.rootTarget,
    },
    startIso: record.createdAt,
    atIso: record.updatedAt,
  };
}

/**
 * Cap on the deduped-run set. Dedup only needs to guard the in-process
 * `cancelling` → `cancelled` double-fire for the current run, so a bound this
 * large never evicts an active run, yet keeps a long-lived plugin instance
 * (reused across many runs by a server/daemon) from growing without bound.
 */
export const DEDUP_CAP = 1024;

/** Record a run id in the bounded dedup set, evicting the oldest when full. */
function remember(emitted: Set<string>, id: string): void {
  emitted.add(id);
  if (emitted.size > DEDUP_CAP) {
    const oldest = emitted.values().next().value;
    if (oldest !== undefined) emitted.delete(oldest);
  }
}

/** One `zuke.run.suspended` counter per target currently parked on a wait. */
function suspendedPoints(record: RunRecord): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (const [name, state] of Object.entries(record.targets)) {
    if (state.status !== "waiting") continue;
    points.push({
      name: "zuke.run.suspended",
      unit: "1",
      value: 1,
      attributes: {
        "zuke.build": record.build,
        "zuke.target": name,
        trigger: state.waitingFor?.trigger ?? "unknown",
      },
      startIso: record.createdAt,
      atIso: record.updatedAt,
    });
  }
  return points;
}

/**
 * Build the OTel plugin from an already-resolved resource identity and an
 * explicit {@link OtlpTransport}. {@link otel} wraps this with settings/env
 * resolution and the HTTP transport; tests call it directly with a capturing
 * fake to assert the exported payloads.
 */
export function createOtelPlugin(
  transport: OtlpTransport,
  resource: OtlpResource,
): Plugin {
  const emitted = new Set<string>(); // run ids whose trace has been exported
  return {
    name: "otel",
    async onRunStateChange(record: RunRecord): Promise<void> {
      const status = record.status;
      if (status === "running") {
        if (isFreshStart(record)) {
          await transport.metrics(
            buildMetrics([startedPoint(record)], resource),
          );
        }
        return;
      }
      if (status === "suspended") {
        const points = suspendedPoints(record);
        if (points.length > 0) {
          await transport.metrics(buildMetrics(points, resource));
        }
        return;
      }
      // Any other status is terminal: succeeded / failed / cancelled, or
      // cancelling when another process owns the final settle. Export the trace
      // once — the in-process cancel fires `cancelling` then `cancelled`.
      if (emitted.has(record.id)) return;
      remember(emitted, record.id);
      const ids = await runSpanIds(record);
      // Fire both signals concurrently: a hung collector stalls the terminal
      // transition by at most one timeout, not two. Both are best-effort and
      // never reject, so Promise.all cannot reject either.
      await Promise.all([
        transport.traces(buildTraces(record, ids, resource)),
        transport.metrics(buildMetrics([outcomePoint(record)], resource)),
      ]);
    },
  };
}

/** Injectable dependencies for {@link otelWith} — the seams tests reach for. */
export interface OtelDeps {
  /** Environment reader; defaults to `Deno.env.get`. */
  readEnv?: (name: string) => string | undefined;
  /** A transport to use directly, bypassing the HTTP exporter (tests). */
  transport?: OtlpTransport;
  /** The `fetch` seam handed to the default HTTP exporter (tests). */
  fetch?: typeof fetch;
}

/** Read an environment variable, treating missing env access as unset. */
function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/**
 * {@link otel} with injectable dependencies — the entry point that both the
 * public factory and the tests call. When no endpoint resolves (neither a
 * setter nor `OTEL_EXPORTER_OTLP_ENDPOINT`), the returned plugin is inert.
 */
export function otelWith(
  configure: Configure<OtelSettings> | undefined,
  deps: OtelDeps,
): Plugin {
  const settings = (configure ?? ((s) => s))(new OtelSettings());
  const resolved = resolveOtel(settings, deps.readEnv ?? defaultReadEnv);
  if (resolved === null) return { name: "otel" }; // no endpoint → do nothing
  const transport = deps.transport ??
    new OtlpHttpExporter({
      tracesUrl: resolved.tracesUrl,
      metricsUrl: resolved.metricsUrl,
      headers: resolved.headers,
      timeoutMs: resolved.timeoutMs,
      fetch: deps.fetch,
    });
  return createOtelPlugin(transport, resolved.resource);
}

/**
 * Create the OpenTelemetry export plugin. Register it on a run and every
 * run/target transition is exported as OTLP/HTTP JSON:
 *
 * ```ts
 * import { run } from "jsr:@zuke/core";
 * import { otel } from "jsr:@zuke/otel";
 *
 * await run(MyBuild, {
 *   plugins: [otel((s) => s.endpoint("http://localhost:4318").serviceName("ci"))],
 * });
 * ```
 *
 * With no argument it reads the standard `OTEL_EXPORTER_OTLP_ENDPOINT` /
 * `OTEL_SERVICE_NAME` / `OTEL_EXPORTER_OTLP_HEADERS` environment variables. If
 * no endpoint is configured by either route the plugin is inert, so it is safe
 * to register unconditionally. Telemetry needs a state store (the plugin's
 * records come from durable run state); a store-less build exports nothing.
 */
export function otel(configure?: Configure<OtelSettings>): Plugin {
  return otelWith(configure, {});
}
