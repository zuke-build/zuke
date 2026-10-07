// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link cloudMonitoring} — a Cloud Monitoring metric as a `@zuke/canary`
 * analysis: read the metric over a recent window and fail the canary when
 * any point is out of bounds. Or, with `.logEntries(...)`, the number of log
 * entries a Cloud Logging filter matches over the window.
 *
 * ```ts
 * import { canary } from "@zuke/canary";
 * import { cloudMonitoring, cloudRunCanary } from "@zuke/gcloud";
 *
 * rollout = canary((c) =>
 *   c.platform(cloudRunCanary((r) =>
 *     r.service("api").region("europe-west1").image(this.image.value)
 *   ))
 *     .steps(10, 50)
 *     .analysis(cloudMonitoring((m) =>
 *       m.name("canary 5xx").project("my-proj")
 *         .metricType("run.googleapis.com/request_count")
 *         .resourceType("cloud_run_revision")
 *         .cloudRunCandidate("api", "europe-west1")
 *         .metricLabel("response_code_class", "5xx")
 *         .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
 *         .crossSeriesReducer("REDUCE_SUM")
 *         .window("5m").max(5).missingDataAs(0)
 *     ))
 * );
 * ```
 *
 * It reads the same way `@zuke/canary`'s `prometheus(...)` does — a name, a
 * query, a `min` and/or a `max` — and fails with the same words. The canary
 * engine's analysis interface lives in `@zuke/canary`, and a wrapper depends
 * only on `@zuke/core`, so this module does not import it: the object
 * {@link cloudMonitoring} returns has the same shape and is accepted by
 * `c.analysis(...)` as it is.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { readTimeSeries } from "./cloud_monitoring.ts";
import {
  candidateRevision,
  type CloudRunService,
} from "./cloud_run_candidate.ts";
import { countEntries } from "./log_entry_count.ts";
import { GcloudLoggingReadSettings } from "./logging.ts";
import { numericPoints } from "./metric_value.ts";
import { boundsOf, checkThreshold } from "./threshold.ts";
import {
  CloudMonitoringTimeSeriesSettings,
  intervalOf,
} from "./time_series_settings.ts";
import { finite } from "./validate.ts";

/** The task name in this analysis's errors. */
const TASK = "cloudMonitoring";

/**
 * The part of the canary engine's context the analysis uses: the run's
 * redactor, applied to every failure message. The engine hands a richer
 * context; this is the narrow view.
 */
export interface CloudMonitoringAnalysisContext {
  /** Mask every resolved `secret` parameter in `text`. */
  redact(text: string): string;
}

/**
 * A health check run against a canary, in the shape `@zuke/canary`'s
 * `c.analysis(...)` accepts: throw to fail it, which rolls the rollout back.
 */
export interface CloudMonitoringAnalysis {
  /** `"cloudMonitoring"`, for diagnostics. */
  readonly name: string;
  /** Read the metric and throw when a point is out of bounds. */
  validate(context: CloudMonitoringAnalysisContext): Promise<void>;
}

/**
 * Settings for {@link cloudMonitoring}: the metric — with the same setters
 * as a `CloudMonitoringTasks.timeSeriesList` read, which these extend — or a
 * log filter, and the bounds.
 */
export class CloudMonitoringAnalysisSettings
  extends CloudMonitoringTimeSeriesSettings {
  /** What the metric is called in a failure (set by {@link name}). */
  name_?: string;
  /** The lowest acceptable value (set by {@link min}). */
  min_?: number;
  /** The highest acceptable value (set by {@link max}). */
  max_?: number;
  /** The value to judge when there is no data (set by {@link missingDataAs}). */
  missingData_?: number;
  /** The log filter of the log-count mode (set by {@link logEntries}). */
  logEntries_?: Configure<GcloudLoggingReadSettings>;
  /** The service whose candidate revision is judged (set by {@link cloudRunCandidate}). */
  cloudRunCandidate_?: CloudRunService;

  /**
   * Judge only the canary revision of a Cloud Run service: before each
   * check, read the service's latest created revision — the one
   * `cloudRunCanary(...)` staged — with the `.gcloud(...)` flags, and narrow
   * the metric (or the log filter) to `resource.labels.service_name` and
   * `resource.labels.revision_name`. Pair it with
   * `.resourceType("cloud_run_revision")`. A revision deployed by someone
   * else mid-rollout would be read instead; `cloudRunCanary`'s promote
   * refuses that case before moving traffic.
   */
  cloudRunCandidate(service: string, region?: string): this {
    this.cloudRunCandidate_ = region === undefined
      ? { service }
      : { service, region };
    return this;
  }

  /** What to call the metric when it is out of bounds. */
  name(name: string): this {
    this.name_ = name;
    return this;
  }

  /** Fail when any point is below `value`, a finite number. */
  min(value: number): this {
    this.min_ = finite(TASK, "min", value);
    return this;
  }

  /** Fail when any point is above `value`, a finite number. */
  max(value: number): this {
    this.max_ = finite(TASK, "max", value);
    return this;
  }

  /**
   * Judge `value` when the window has no points, instead of failing. Cloud
   * Monitoring writes no point for a period with no events, so for a count
   * of errors no data means `0`; for a latency it usually means the metric,
   * resource or labels are wrong, which is why that is a failure by default.
   */
  missingDataAs(value: number): this {
    this.missingData_ = finite(TASK, "missingDataAs", value);
    return this;
  }

  /**
   * Judge the number of log entries a Cloud Logging filter matches over the
   * window, instead of a metric — `(l) => l.resourceType("cloud_run_revision")
   * .resourceLabel("revision_name", rev).minSeverity("ERROR")`. The window is
   * added to the filter as `timestamp` bounds, and the read runs with the
   * `.gcloud(...)` flags. It counts at most `.limit(n)` entries (default
   * 1000) and fails when more match, since the exact count is then unknown.
   * Only each entry's id is read: no payload reaches the build. A
   * {@link project} set on the analysis is the read's `--project` too.
   */
  logEntries(configure: Configure<GcloudLoggingReadSettings>): this {
    this.logEntries_ = configure;
    return this;
  }
}

/** One value to judge, and what to call it. */
interface Judged {
  /** The metric and, for a point, when it was. */
  label: string;
  /** The value. */
  value: number;
}

/** Whether any part of the metric's filter is set. */
function narrowsMetric(settings: CloudMonitoringAnalysisSettings): boolean {
  return settings.metricType_ !== undefined ||
    settings.resourceType_ !== undefined ||
    settings.resourceLabels_.length > 0 ||
    settings.metricLabels_.length > 0 ||
    settings.filters_.length > 0;
}

/** The label a failure names: the analysis's name, or what it reads. */
function labelOf(settings: CloudMonitoringAnalysisSettings): string {
  return settings.name_ ?? settings.metricType_ ??
    (settings.logEntries_ === undefined
      ? "cloud monitoring metric"
      : "log entries");
}

/**
 * The `[key, value]` resource labels that narrow a read to the Cloud Run
 * candidate, when one is set — read afresh on each check.
 */
async function candidateLabels(
  settings: CloudMonitoringAnalysisSettings,
): Promise<Array<[string, string]>> {
  const target = settings.cloudRunCandidate_;
  if (target === undefined) return [];
  const revision = await candidateRevision(target, settings.gcloud_, TASK);
  return [["service_name", target.service], ["revision_name", revision]];
}

/** The points of the metric `settings` describe, over its aligned window. */
async function metricPoints(
  settings: CloudMonitoringAnalysisSettings,
  label: string,
): Promise<Judged[]> {
  const candidate = await candidateLabels(settings);
  // The analysis judges points, and a HEADERS view returns none.
  settings.view("FULL");
  const series = await readTimeSeries(settings, TASK, candidate);
  return numericPoints(series, TASK).map((point) => ({
    label: `${label} at ${point.end.toISOString()}`,
    value: point.value,
  }));
}

/** The number of log entries the filter matches over the window. */
async function logPoints(
  settings: CloudMonitoringAnalysisSettings,
  configure: Configure<GcloudLoggingReadSettings>,
  label: string,
): Promise<Judged[]> {
  const { start, end } = intervalOf(settings, TASK);
  const base = new GcloudLoggingReadSettings();
  if (settings.project_ !== undefined) base.project(settings.project_);
  const read = configure(base).since(start).until(end);
  for (const [key, value] of await candidateLabels(settings)) {
    read.resourceLabel(key, value);
  }
  return [{ label, value: await countEntries(read, TASK, settings.gcloud_) }];
}

/**
 * Run `step`, turning anything it throws into an `Error` whose message is
 * `prefix` and the original message, passed through the run's redactor.
 */
async function attempt<T>(
  context: CloudMonitoringAnalysisContext,
  prefix: string,
  step: () => T | Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(context.redact(`${prefix}${message}`));
  }
}

/**
 * An analysis that reads a Cloud Monitoring metric — or counts log entries
 * — over a recent window and fails the canary when any point is out of
 * bounds, or when there is no data, unless
 * {@link CloudMonitoringAnalysisSettings.missingDataAs} says what no data
 * means.
 *
 * The lambda runs on each check, so it may read resolved parameters, and
 * every failure message — one from the lambda included — passes through the
 * run's redactor.
 */
export function cloudMonitoring(
  configure: Configure<CloudMonitoringAnalysisSettings>,
): CloudMonitoringAnalysis {
  return {
    name: TASK,
    async validate(context) {
      const { settings, label, bounds } = await attempt(context, "", () => {
        const settings = configure(new CloudMonitoringAnalysisSettings());
        const label = labelOf(settings);
        if (settings.logEntries_ !== undefined && narrowsMetric(settings)) {
          throw new Error(
            `cloudMonitoring "${label}" judges a metric or log entries, not ` +
              "both — the metric's filter (.metricType, .resourceType, " +
              ".resourceLabel, .metricLabel, .filter) would not narrow the " +
              "log read. Put the log filter inside .logEntries(...).",
          );
        }
        const bounds = boundsOf(label, settings.min_, settings.max_);
        return { settings, label, bounds };
      });
      const logs = settings.logEntries_;
      const judged = await attempt(
        context,
        `${label} could not be read: `,
        () =>
          logs === undefined
            ? metricPoints(settings, label)
            : logPoints(settings, logs, label),
      );
      if (judged.length === 0) {
        const missing = settings.missingData_;
        if (missing === undefined) {
          throw new Error(context.redact(
            `${label} has no data in the last ${settings.window_} ms — check ` +
              "the project, metric type, resource and labels, or call " +
              ".missingDataAs(0) if no data means healthy.",
          ));
        }
        judged.push({ label: `${label} (no data)`, value: missing });
      }
      for (const point of judged) {
        await attempt(
          context,
          "",
          () => checkThreshold(point.label, point.value, bounds),
        );
      }
    },
  };
}
