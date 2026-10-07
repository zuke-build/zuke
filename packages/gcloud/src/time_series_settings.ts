// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link CloudMonitoringTimeSeriesSettings} — what a Cloud Monitoring
 * `projects.timeSeries.list` call reads: the metric (as a filter built from
 * typed parts), the interval, the aggregation, and how the call reaches the
 * API. The request itself is assembled here too, by {@link timeSeriesRequest},
 * so the validation and the query it guards sit together.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import type { AccessTokenProvider } from "./auth.ts";
import { conjunction, labelKey, monitoringString } from "./filter.ts";
import { checkCount } from "./limit.ts";
import { resolveProject } from "./project.ts";
import type { GcloudSettings } from "./settings.ts";

/** The Cloud Monitoring v3 API root. */
const MONITORING_BASE = "https://monitoring.googleapis.com/v3";

/** The window read when none is set: the last five minutes. */
const DEFAULT_WINDOW = 5 * 60_000;

/** The most pages read when none is set. */
export const DEFAULT_MAX_PAGES = 100;

/** The shortest alignment period the API accepts: 60 seconds. */
const MIN_ALIGNMENT_PERIOD = 60_000;

/**
 * How each series' points are aligned into one value per alignment period
 * (`aggregation.perSeriesAligner`).
 */
export type CloudMonitoringAligner =
  | "ALIGN_NONE"
  | "ALIGN_DELTA"
  | "ALIGN_RATE"
  | "ALIGN_INTERPOLATE"
  | "ALIGN_NEXT_OLDER"
  | "ALIGN_MIN"
  | "ALIGN_MAX"
  | "ALIGN_MEAN"
  | "ALIGN_COUNT"
  | "ALIGN_SUM"
  | "ALIGN_STDDEV"
  | "ALIGN_COUNT_TRUE"
  | "ALIGN_COUNT_FALSE"
  | "ALIGN_FRACTION_TRUE"
  | "ALIGN_PERCENTILE_99"
  | "ALIGN_PERCENTILE_95"
  | "ALIGN_PERCENTILE_50"
  | "ALIGN_PERCENTILE_05"
  | "ALIGN_PERCENT_CHANGE";

/** How aligned series are combined into fewer (`aggregation.crossSeriesReducer`). */
export type CloudMonitoringReducer =
  | "REDUCE_NONE"
  | "REDUCE_MEAN"
  | "REDUCE_MIN"
  | "REDUCE_MAX"
  | "REDUCE_SUM"
  | "REDUCE_STDDEV"
  | "REDUCE_COUNT"
  | "REDUCE_COUNT_TRUE"
  | "REDUCE_COUNT_FALSE"
  | "REDUCE_FRACTION_TRUE"
  | "REDUCE_PERCENTILE_99"
  | "REDUCE_PERCENTILE_95"
  | "REDUCE_PERCENTILE_50"
  | "REDUCE_PERCENTILE_05";

/** How much of each series the API returns: its points, or only its labels. */
export type CloudMonitoringView = "FULL" | "HEADERS";

/**
 * Settings for a Cloud Monitoring time-series read, configured through
 * `CloudMonitoringTasks.timeSeriesList((s) => …)`.
 *
 * ```ts
 * s.project("my-proj")
 *   .metricType("run.googleapis.com/request_count")
 *   .resourceType("cloud_run_revision")
 *   .resourceLabel("service_name", "api")
 *   .metricLabel("response_code_class", "5xx")
 *   .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
 *   .crossSeriesReducer("REDUCE_SUM")
 *   .window("15m")
 * ```
 */
export class CloudMonitoringTimeSeriesSettings {
  /** The project read from (set by {@link project}). */
  project_?: string;
  /** The metric type (set by {@link metricType}). */
  metricType_?: string;
  /** The monitored-resource type (set by {@link resourceType}). */
  resourceType_?: string;
  /** Resource labels the series must carry (set by {@link resourceLabel}). */
  readonly resourceLabels_: Array<[string, string]> = [];
  /** Metric labels the series must carry (set by {@link metricLabel}). */
  readonly metricLabels_: Array<[string, string]> = [];
  /** Raw filter parts (set by {@link filter}). */
  readonly filters_: string[] = [];
  /** How far back to read, in ms (set by {@link window}). */
  window_: number = DEFAULT_WINDOW;
  /** An explicit interval, instead of the window (set by {@link interval}). */
  interval_?: { start: Date; end: Date };
  /** The alignment period, in ms (set by {@link alignmentPeriod}). */
  alignmentPeriod_?: number;
  /** The per-series aligner (set by {@link perSeriesAligner}). */
  perSeriesAligner_?: CloudMonitoringAligner;
  /** The cross-series reducer (set by {@link crossSeriesReducer}). */
  crossSeriesReducer_?: CloudMonitoringReducer;
  /** The labels the reducer keeps series apart by (set by {@link groupByFields}). */
  readonly groupByFields_: string[] = [];
  /** How much of each series to return (set by {@link view}). */
  view_: CloudMonitoringView = "FULL";
  /** The page size to ask for (set by {@link pageSize}). */
  pageSize_?: number;
  /** The most pages to read before failing (set by {@link maxPages}); 100 when unset. */
  maxPages_?: number;
  /** How far before now the window ends, in ms (set by {@link delay}). */
  delay_?: number;
  /** A pre-resolved OAuth token (set by {@link token}). */
  token_?: string;
  /** Resolves the token (set by {@link tokenProvider}). */
  tokenProvider_?: AccessTokenProvider;
  /** Global gcloud flags for the default token read (set by {@link gcloud}). */
  gcloud_: Configure<GcloudSettings> = (g) => g;
  /** The `fetch` the API is called through (set by {@link fetch}). */
  fetch_?: typeof fetch;
  /** Reads an environment variable for the project (set by {@link readEnv}). */
  readEnv_?: (name: string) => string | undefined;
  /** The clock the window is read against (set by {@link now}). */
  now_: () => Date = () => new Date();

  /**
   * The project to read from; when omitted, `GOOGLE_CLOUD_PROJECT` (then
   * `GCLOUD_PROJECT`).
   */
  project(id: string): this {
    this.project_ = id;
    return this;
  }

  /**
   * The metric to read: `metric.type = "<type>"`, e.g.
   * `"run.googleapis.com/request_count"`. The API reads exactly one metric
   * type per call.
   */
  metricType(type: string): this {
    this.metricType_ = type;
    return this;
  }

  /** Only series on this monitored-resource type: `resource.type = "<type>"`. */
  resourceType(type: string): this {
    this.resourceType_ = type;
    return this;
  }

  /** Only series whose resource label `key` is `value`; repeatable. */
  resourceLabel(key: string, value: string): this {
    this.resourceLabels_.push([key, value]);
    return this;
  }

  /** Only series whose metric label `key` is `value`; repeatable. */
  metricLabel(key: string, value: string): this {
    this.metricLabels_.push([key, value]);
    return this;
  }

  /**
   * Raw text in the Monitoring filter language, joined with the typed parts
   * by `AND`; repeatable. It is the caller's own text and is not escaped —
   * never build it from an untrusted value. With no {@link metricType}, it
   * must name the metric itself.
   */
  filter(expression: string): this {
    this.filters_.push(expression);
    return this;
  }

  /**
   * How far back to read (`"15m"`, or ms; default five minutes), ending now
   * — or, with an {@link alignmentPeriod}, at the last period boundary, so
   * the period still being written is not read. The window must be at least
   * one period long.
   */
  window(duration: string | number): this {
    const ms = parseDuration(duration);
    if (ms <= 0) {
      throw new Error(
        `CloudMonitoringTasks: .window(${
          JSON.stringify(duration)
        }) must be longer than zero.`,
      );
    }
    this.window_ = ms;
    return this;
  }

  /** Read exactly this interval instead of a window ending now. */
  interval(start: Date, end: Date): this {
    this.interval_ = { start, end };
    return this;
  }

  /** The clock the window is read against — the seam a test pins it with. */
  now(clock: () => Date): this {
    this.now_ = clock;
    return this;
  }

  /**
   * What each aligned point covers (`aggregation.alignmentPeriod`) —
   * `"60s"`, `"5m"`, or ms; whole seconds, at least 60, as the API requires.
   */
  alignmentPeriod(duration: string | number): this {
    const ms = parseDuration(duration);
    if (ms < MIN_ALIGNMENT_PERIOD || ms % 1000 !== 0) {
      throw new Error(
        `CloudMonitoringTasks: .alignmentPeriod(${
          JSON.stringify(duration)
        }) must be whole seconds, at least 60 — the API refuses a shorter one.`,
      );
    }
    this.alignmentPeriod_ = ms;
    return this;
  }

  /** How each series is aligned (`aggregation.perSeriesAligner`). */
  perSeriesAligner(aligner: CloudMonitoringAligner): this {
    this.perSeriesAligner_ = aligner;
    return this;
  }

  /** How aligned series are combined (`aggregation.crossSeriesReducer`). */
  crossSeriesReducer(reducer: CloudMonitoringReducer): this {
    this.crossSeriesReducer_ = reducer;
    return this;
  }

  /**
   * The labels the reducer keeps series apart by
   * (`aggregation.groupByFields`), e.g. `"resource.labels.revision_name"`.
   */
  groupByFields(...fields: string[]): this {
    this.groupByFields_.push(...fields);
    return this;
  }

  /** `FULL` (the default) returns points; `HEADERS` only each series' labels. */
  view(view: CloudMonitoringView): this {
    this.view_ = view;
    return this;
  }

  /** The most results per page (`pageSize`; the API's default is 100,000). */
  pageSize(count: number): this {
    checkCount(count, "CloudMonitoringTasks", "pageSize");
    this.pageSize_ = count;
    return this;
  }

  /**
   * The most pages to read (default 100). A read that still has a next page
   * after that many fails — a partial answer is never returned as a whole.
   */
  maxPages(count: number): this {
    checkCount(count, "CloudMonitoringTasks", "maxPages");
    this.maxPages_ = count;
    return this;
  }

  /**
   * End the window this long before now (`"2m"`, or ms) — for the time a
   * metric takes to become readable. Google's metrics list gives it per
   * metric: Cloud Run's `request_count` and `request_latencies` are "not
   * visible for up to 120 seconds" after sampling. Without it the newest
   * points may not exist yet, or hold only part of their period. Default
   * `0` for a read; the `cloudMonitoring(...)` analysis defaults to two
   * minutes.
   */
  delay(duration: string | number): this {
    this.delay_ = parseDuration(duration);
    return this;
  }

  /** A pre-resolved OAuth access token. */
  token(value: string): this {
    this.token_ = value;
    return this;
  }

  /** Resolves the access token, when no {@link token} is set. */
  tokenProvider(provider: AccessTokenProvider): this {
    this.tokenProvider_ = provider;
    return this;
  }

  /**
   * Global gcloud flags for the default token read,
   * `gcloud auth print-access-token` — `(g) => g.account("ci@p.iam…")`, or a
   * `.runner(...)`, the seam a test answers through. Unused when a
   * {@link token} or {@link tokenProvider} is set.
   */
  gcloud(configure: Configure<GcloudSettings>): this {
    this.gcloud_ = configure;
    return this;
  }

  /** The `fetch` the API is called through; the global by default. */
  fetch(implementation: typeof fetch): this {
    this.fetch_ = implementation;
    return this;
  }

  /** Reads an environment variable for the project; `Deno.env.get` by default. */
  readEnv(reader: (name: string) => string | undefined): this {
    this.readEnv_ = reader;
    return this;
  }
}

/** A start and end time. */
export interface TimeInterval {
  /** The start of the interval. */
  start: Date;
  /** The end of the interval. */
  end: Date;
}

/**
 * The interval the settings read: explicit, or the window ending
 * `delayDefault` ms (or the settings' own {@link CloudMonitoringTimeSeriesSettings.delay})
 * before now, aligned down to the alignment period when there is one.
 */
export function intervalOf(
  settings: CloudMonitoringTimeSeriesSettings,
  task: string,
  delayDefault: number,
): TimeInterval {
  const explicit = settings.interval_;
  if (explicit !== undefined) {
    if (
      Number.isNaN(explicit.start.getTime()) ||
      Number.isNaN(explicit.end.getTime())
    ) {
      throw new Error(`${task}: the interval holds an invalid date.`);
    }
    if (explicit.start.getTime() > explicit.end.getTime()) {
      throw new Error(
        `${task}: the interval starts after it ends — swap the times.`,
      );
    }
    return explicit;
  }
  const window = settings.window_;
  const period = settings.alignmentPeriod_;
  const now = settings.now_().getTime() - (settings.delay_ ?? delayDefault);
  if (Number.isNaN(now)) {
    throw new Error(
      `${task}: the clock set with .now(...) gave an invalid date.`,
    );
  }
  if (period === undefined) {
    return { start: new Date(now - window), end: new Date(now) };
  }
  if (window < period) {
    throw new Error(
      `${task}: the window of ${window} ms is shorter than the alignment ` +
        `period of ${period} ms, so it holds no whole period. Widen ` +
        ".window(...) or shorten .alignmentPeriod(...).",
    );
  }
  const end = Math.floor(now / period) * period;
  return { start: new Date(end - window), end: new Date(end) };
}

/** The Monitoring filter the settings describe. */
function filterOf(
  settings: CloudMonitoringTimeSeriesSettings,
  task: string,
  extraResourceLabels: ReadonlyArray<[string, string]>,
): string {
  const typed: string[] = [];
  if (settings.metricType_ !== undefined) {
    typed.push(
      `metric.type = ${
        monitoringString(task, "metric type", settings.metricType_)
      }`,
    );
  }
  if (settings.resourceType_ !== undefined) {
    typed.push(
      `resource.type = ${
        monitoringString(task, "resource type", settings.resourceType_)
      }`,
    );
  }
  const label = (scope: string, [key, value]: [string, string]) =>
    `${scope}.labels.${labelKey(task, key)} = ${
      monitoringString(task, `${scope} label value`, value)
    }`;
  for (const pair of [...settings.resourceLabels_, ...extraResourceLabels]) {
    typed.push(label("resource", pair));
  }
  for (const pair of settings.metricLabels_) typed.push(label("metric", pair));
  const written = settings.filters_.some((part) => part.trim() !== "");
  if (settings.metricType_ === undefined && !written) {
    throw new Error(
      `${task}: no metric named — add .metricType("<type>"), e.g. ` +
        '"run.googleapis.com/request_count", or a raw .filter(...).',
    );
  }
  return conjunction(typed, settings.filters_);
}

/** Refuse an aggregation the API would, in its own terms. */
function checkAggregation(
  settings: CloudMonitoringTimeSeriesSettings,
  task: string,
): void {
  const aligner = settings.perSeriesAligner_;
  const reducer = settings.crossSeriesReducer_;
  const aligned = aligner !== undefined && aligner !== "ALIGN_NONE";
  const reduced = reducer !== undefined && reducer !== "REDUCE_NONE";
  if (aligned && settings.alignmentPeriod_ === undefined) {
    throw new Error(
      `${task}: ${aligner} needs an alignment period — add ` +
        '.alignmentPeriod("60s").',
    );
  }
  if (reduced && !aligned) {
    throw new Error(
      `${task}: ${reducer} combines aligned series, so it needs a ` +
        "per-series aligner other than ALIGN_NONE — add " +
        '.perSeriesAligner("ALIGN_SUM") or another.',
    );
  }
  if (settings.groupByFields_.length > 0 && !reduced) {
    throw new Error(
      `${task}: .groupByFields(...) only applies with a cross-series ` +
        "reducer — add .crossSeriesReducer(...).",
    );
  }
}

/** What a read adds to the settings, without changing them. */
export interface TimeSeriesQuery {
  /** Resource labels that narrow the filter beyond the settings' own. */
  extraResourceLabels?: ReadonlyArray<[string, string]>;
  /** The interval, when the caller has resolved it already. */
  interval?: TimeInterval;
  /** Aborts the read between pages and in flight. */
  signal?: AbortSignal;
}

/**
 * The URL of the first page the settings ask for — the query a page token is
 * added to for each later page — refusing settings the API would refuse.
 * `query.extraResourceLabels` narrow it further without changing the
 * settings, so a settings instance read twice is read the same way both
 * times.
 */
export function timeSeriesRequest(
  settings: CloudMonitoringTimeSeriesSettings,
  task: string,
  query: TimeSeriesQuery,
): URL {
  checkAggregation(settings, task);
  const filter = filterOf(settings, task, query.extraResourceLabels ?? []);
  const { start, end } = query.interval ?? intervalOf(settings, task, 0);
  const project = resolveProject(
    { project: settings.project_, readEnv: settings.readEnv_ },
    task,
    "add .project(id)",
  );
  const url = new URL(
    `${MONITORING_BASE}/projects/${encodeURIComponent(project)}/timeSeries`,
  );
  const params = url.searchParams;
  params.set("filter", filter);
  params.set("interval.startTime", start.toISOString());
  params.set("interval.endTime", end.toISOString());
  if (settings.alignmentPeriod_ !== undefined) {
    params.set(
      "aggregation.alignmentPeriod",
      `${settings.alignmentPeriod_ / 1000}s`,
    );
  }
  if (settings.perSeriesAligner_ !== undefined) {
    params.set("aggregation.perSeriesAligner", settings.perSeriesAligner_);
  }
  if (settings.crossSeriesReducer_ !== undefined) {
    params.set("aggregation.crossSeriesReducer", settings.crossSeriesReducer_);
  }
  for (const field of settings.groupByFields_) {
    params.append("aggregation.groupByFields", field);
  }
  params.set("view", settings.view_);
  if (settings.pageSize_ !== undefined) {
    params.set("pageSize", String(settings.pageSize_));
  }
  return url;
}
