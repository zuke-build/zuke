// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link azureMonitor} — an Azure Monitor metric as a `@zuke/canary`
 * analysis: read the metric over a recent window and fail the canary when any
 * datapoint is out of bounds. Or, with `.kql(...)`, a Log Analytics query
 * that yields one number.
 *
 * ```ts
 * import { canary } from "@zuke/canary";
 * import { azureMonitor } from "@zuke/az";
 *
 * rollout = canary((c) =>
 *   c.platform(platform).steps(10, 50)
 *     .analysis(azureMonitor((m) =>
 *       m.name("canary 5xx").resource(appInsightsId)
 *         .metric("requests/failed").aggregation("Count")
 *         .dimension("cloud/roleName", "api-canary")
 *         .window("5m").max(5).missingDataAs(0)
 *         .az((a) => a.subscription("prod"))
 *     ))
 * );
 * ```
 *
 * It reads the same way `@zuke/canary`'s `prometheus(...)` does — a name, a
 * query, a `min` and/or a `max` — and fails with the same words. The canary
 * engine's analysis interface lives in `@zuke/canary`, and a wrapper depends
 * only on `@zuke/core`, so this module does not import it: the object
 * {@link azureMonitor} returns has the same shape and is accepted by
 * `c.analysis(...)` as it is.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { AzOutputError } from "./errors.ts";
import { AzMonitorLogAnalyticsQuerySettings, rowsOf } from "./log_analytics.ts";
import { aggregationKey, metricDataOf, METRICS_QUERY } from "./metric_data.ts";
import {
  type AzMonitorAggregation,
  type AzMonitorInterval,
  AzMonitorMetricsListSettings,
  INTERVAL_MS,
} from "./monitor.ts";
import { jsonFrom, WHOLE_ANSWER } from "./reader.ts";
import type { AzSettings } from "./settings.ts";
import { boundsOf, checkThreshold } from "./threshold.ts";
import { finite } from "./validate.ts";

/** The window read when none is set: the last five minutes. */
const DEFAULT_WINDOW = 5 * 60_000;

/** The task name in this analysis's errors. */
const TASK = "azureMonitor";

/**
 * The part of the canary engine's context the analysis uses: the run's
 * redactor, applied to every failure message. The engine hands a richer
 * context; this is the narrow view.
 */
export interface AzMonitorAnalysisContext {
  /** Mask every resolved `secret` parameter in `text`. */
  redact(text: string): string;
}

/**
 * A health check run against a canary, in the shape `@zuke/canary`'s
 * `c.analysis(...)` accepts: throw to fail it, which rolls the rollout back.
 */
export interface AzMonitorAnalysis {
  /** `"azureMonitor"`, for diagnostics. */
  readonly name: string;
  /** Read the metric and throw when a datapoint is out of bounds. */
  validate(context: AzMonitorAnalysisContext): Promise<void>;
}

/** Settings for {@link azureMonitor}: the metric or query, the window and the bounds. */
export class AzMonitorAnalysisSettings {
  /** What the metric is called in a failure (set by {@link name}). */
  name_?: string;
  /** The resource whose metric is read (set by {@link resource}). */
  resource_?: string;
  /** The metric's name (set by {@link metric}). */
  metric_?: string;
  /** The metric's namespace (set by {@link namespace}). */
  namespace_?: string;
  /** The aggregation judged (set by {@link aggregation}). */
  aggregation_?: AzMonitorAggregation;
  /** What each datapoint covers (set by {@link interval}). */
  interval_: AzMonitorInterval = "PT1M";
  /** The dimension values the series is narrowed to (set by {@link dimension}). */
  readonly dimensions_: Array<[string, string]> = [];
  /** The workspace and query of the KQL mode (set by {@link kql}). */
  kql_?: { workspace: string; query: string };
  /** How far back to read, in ms (set by {@link window}). */
  window_: number = DEFAULT_WINDOW;
  /** The lowest acceptable value (set by {@link min}). */
  min_?: number;
  /** The highest acceptable value (set by {@link max}). */
  max_?: number;
  /** The value to judge when there is no data (set by {@link missingDataAs}). */
  missingData_?: number;
  /** Global options for the command (set by {@link az}). */
  az_: Configure<AzSettings> = (a) => a;
  /** The clock the window is read against (set by {@link now}). */
  now_: () => Date = () => new Date();

  /** What to call the metric when it is out of bounds. */
  name(name: string): this {
    this.name_ = name;
    return this;
  }

  /** The resource whose metric is read, by full resource id (`--resource`). */
  resource(id: string): this {
    this.resource_ = id;
    return this;
  }

  /** The metric to judge, by name (`--metrics`). */
  metric(name: string): this {
    this.metric_ = name;
    return this;
  }

  /** The metric's namespace, when the resource has several (`--namespace`). */
  namespace(namespace: string): this {
    this.namespace_ = namespace;
    return this;
  }

  /** The aggregation judged per interval (`--aggregation`), e.g. `"Total"`. */
  aggregation(aggregation: AzMonitorAggregation): this {
    this.aggregation_ = aggregation;
    return this;
  }

  /**
   * What each datapoint covers (`--interval`; default `PT1M`). Every
   * datapoint is judged, so `.max(5)` on a per-minute `Total` means "no
   * minute with more than five".
   */
  interval(interval: AzMonitorInterval): this {
    this.interval_ = interval;
    return this;
  }

  /** Only the series where dimension `name` is `value`; repeatable. */
  dimension(name: string, value: string): this {
    this.dimensions_.push([name, value]);
    return this;
  }

  /**
   * Judge a Log Analytics query instead of a metric: `query` must return one
   * row with one numeric column (`... | summarize count()`), run over the
   * window against the workspace `workspace`. Needs the CLI's `log-analytics`
   * extension installed.
   */
  kql(workspace: string, query: string): this {
    this.kql_ = { workspace, query };
    return this;
  }

  /**
   * How far back to read (`"10m"`, or ms; default 5 minutes). For a metric
   * the window ends at the last interval boundary, so the interval still
   * being written is not judged. Azure Monitor publishes a datapoint a
   * little after its interval ends, so the newest one in the window may
   * still be short of data — harmless for a `max`, but a `min` on a `Total`
   * or `Count` can fail on the lag rather than on the candidate.
   */
  window(duration: string | number): this {
    this.window_ = parseDuration(duration);
    return this;
  }

  /** Fail when any datapoint is below `value`. */
  min(value: number): this {
    this.min_ = value;
    return this;
  }

  /** Fail when any datapoint is above `value`. */
  max(value: number): this {
    this.max_ = value;
    return this;
  }

  /**
   * Judge `value` when the window has no data, instead of failing. Azure
   * Monitor reports nothing for an interval with no events, so for a count
   * of errors no data means `0`; for a latency it usually means the
   * resource, metric or dimensions are wrong, which is why that is a failure
   * by default.
   */
  missingDataAs(value: number): this {
    this.missingData_ = finite(TASK, "missingDataAs", value);
    return this;
  }

  /**
   * Global options for the command — `(a) => a.subscription("prod")`, a
   * `.toolPath(...)`, or a `.runner(...)`, the seam a test answers through.
   * `--output` and `--query` are the analysis's own and are set after it.
   */
  az(configure: Configure<AzSettings>): this {
    this.az_ = configure;
    return this;
  }

  /** The clock the window is read against — the seam a test pins it with. */
  now(clock: () => Date): this {
    this.now_ = clock;
    return this;
  }
}

/** One value to judge, and what to call it. */
interface Judged {
  /** The metric and, for a datapoint, when it was. */
  label: string;
  /** The value. */
  value: number;
}

/** The label a failure names: the analysis's name, or what it reads. */
function labelOf(settings: AzMonitorAnalysisSettings): string {
  return settings.name_ ?? settings.metric_ ?? settings.kql_?.query ??
    "azure monitor metric";
}

/** The datapoints of the metric `settings` describe, over its aligned window. */
async function metricPoints(
  settings: AzMonitorAnalysisSettings,
  label: string,
): Promise<Judged[]> {
  const { resource_: resource, metric_: metric } = settings;
  const aggregation = settings.aggregation_;
  if (
    resource === undefined || metric === undefined || aggregation === undefined
  ) {
    throw new Error(
      `azureMonitor "${label}" needs a resource, a metric and an aggregation ` +
        "— add .resource(id).metric(name).aggregation('Total'), or judge a " +
        "query with .kql(workspace, query).",
    );
  }
  const interval = INTERVAL_MS[settings.interval_];
  const end = Math.floor(settings.now_().getTime() / interval) * interval;
  const command = new AzMonitorMetricsListSettings().resource(resource)
    .metrics(metric).aggregation(aggregation).interval(settings.interval_)
    .window(settings.window_, new Date(end));
  if (settings.namespace_ !== undefined) command.namespace(settings.namespace_);
  for (const [name, value] of settings.dimensions_) {
    command.dimension(name, value);
  }
  settings.az_(command);
  const document = await jsonFrom(command, TASK, METRICS_QUERY);
  const { datapoints } = metricDataOf(
    document,
    metric,
    aggregationKey(aggregation),
    TASK,
  );
  return datapoints.map((point) => ({
    label: `${label} at ${point.timestamp.toISOString()}`,
    value: point.value,
  }));
}

/**
 * The one number the KQL query returned — none when it returned no row or an
 * empty cell — refused when the answer is not one row of one number.
 */
async function queryPoints(
  settings: AzMonitorAnalysisSettings,
  kql: { workspace: string; query: string },
  label: string,
): Promise<Judged[]> {
  const command = new AzMonitorLogAnalyticsQuerySettings()
    .workspace(kql.workspace).analyticsQuery(kql.query)
    .timespan(settings.window_);
  settings.az_(command);
  const rows = rowsOf(await jsonFrom(command, TASK, WHOLE_ANSWER), TASK);
  if (rows.length === 0) return [];
  const cells = rows.length === 1
    ? Object.entries(rows[0]).filter(([column]) => column !== "TableName")
    : [];
  if (cells.length !== 1) {
    throw new AzOutputError(
      TASK,
      "the query must return one row with one column — end it with " +
        "`| summarize value = ...` or `| project value`.",
    );
  }
  const [[column, text]] = cells;
  if (text === "None" || text === "") return [];
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new AzOutputError(
      TASK,
      `the query's column "${column}" is not a number.`,
    );
  }
  return [{ label, value }];
}

/**
 * Run `step`, turning anything it throws into an `Error` whose message is
 * `prefix` and the original message, passed through the run's redactor.
 */
async function attempt<T>(
  context: AzMonitorAnalysisContext,
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
 * An analysis that reads an Azure Monitor metric — or a KQL query — over a
 * recent window and fails the canary when any datapoint is out of bounds,
 * or when there is no data, unless
 * {@link AzMonitorAnalysisSettings.missingDataAs} says what no data means.
 *
 * The lambda runs on each check, so it may read resolved parameters, and
 * every failure message — one from the lambda included — passes through the
 * run's redactor.
 */
export function azureMonitor(
  configure: Configure<AzMonitorAnalysisSettings>,
): AzMonitorAnalysis {
  return {
    name: TASK,
    async validate(context) {
      const { settings, label, bounds } = await attempt(context, "", () => {
        const settings = configure(new AzMonitorAnalysisSettings());
        const label = labelOf(settings);
        if (settings.kql_ !== undefined && settings.resource_ !== undefined) {
          throw new Error(
            `azureMonitor "${label}" judges a metric or a query, not both — ` +
              "drop .resource(...) or .kql(...).",
          );
        }
        const bounds = boundsOf(label, settings.min_, settings.max_);
        return { settings, label, bounds };
      });
      const kql = settings.kql_;
      const judged = await attempt(
        context,
        `${label} could not be read: `,
        () =>
          kql === undefined
            ? metricPoints(settings, label)
            : queryPoints(settings, kql, label),
      );
      if (judged.length === 0) {
        const missing = settings.missingData_;
        if (missing === undefined) {
          throw new Error(context.redact(
            `${label} has no data in the last ${settings.window_} ms — check ` +
              "the resource, metric, aggregation and dimensions, or call " +
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
