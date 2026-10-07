// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link cloudwatch} — a CloudWatch metric as a `@zuke/canary` analysis: read
 * the metric over a recent window and fail the canary when any datapoint is
 * out of bounds.
 *
 * ```ts
 * import { canary } from "@zuke/canary";
 * import { cloudwatch } from "@zuke/aws";
 *
 * rollout = canary((c) =>
 *   c.platform(platform).steps(10, 50)
 *     .analysis(cloudwatch((m) =>
 *       m.name("canary 5xx").namespace("AWS/ApplicationELB")
 *         .metric("HTTPCode_Target_5XX_Count")
 *         .dimension("TargetGroup", "targetgroup/api-canary/0a1b")
 *         .stat("Sum").window("5m").max(5).missingDataAs(0)
 *         .region("eu-west-1")
 *     ))
 * );
 * ```
 *
 * It reads the same way `@zuke/canary`'s `prometheus(...)` does — a name, a
 * query, a `min` and/or a `max` — and fails with the same words. The canary
 * engine's analysis interface lives in `@zuke/canary`, and a wrapper depends
 * only on `@zuke/core`, so this module does not import it: the object
 * {@link cloudwatch} returns has the same shape and is accepted by
 * `c.analysis(...)` as it is.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { CloudwatchGetMetricDataSettings } from "./cloudwatch.ts";
import { datapointsOf, METRIC_DATA_RESULTS_QUERY } from "./metric_data.ts";
import {
  type CloudwatchMetricStatSettings,
  type CloudwatchStatistic,
  DEFAULT_PERIOD,
} from "./metric_query.ts";
import { readJson } from "./scalar_output.ts";
import type { AwsSettings, AwsSettingsRunner } from "./settings.ts";
import { boundsOf, checkThreshold } from "./threshold.ts";

/** The window read when none is set: the last five minutes. */
const DEFAULT_WINDOW = 5 * 60_000;

/** The id the analysis's own metric is queried under. */
const METRIC_ID = "m1";

/** The id the analysis's expression is queried under. */
const EXPRESSION_ID = "e1";

/** The task name in this analysis's errors. */
const TASK = "cloudwatch";

/** One minute, the granularity the window's end is aligned to. */
const MINUTE = 60_000;

/**
 * The part of the canary engine's context the analysis uses: the run's
 * redactor, applied to every failure message. The engine hands a richer
 * context; this is the narrow view.
 */
export interface CloudwatchAnalysisContext {
  /** Mask every resolved `secret` parameter in `text`. */
  redact(text: string): string;
}

/**
 * A health check run against a canary, in the shape `@zuke/canary`'s
 * `c.analysis(...)` accepts: throw to fail it, which rolls the rollout back.
 */
export interface CloudwatchAnalysis {
  /** `"cloudwatch"`, for diagnostics. */
  readonly name: string;
  /** Read the metric and throw when a datapoint is out of bounds. */
  validate(context: CloudwatchAnalysisContext): Promise<void>;
}

/** Settings for {@link cloudwatch}: the metric, the window and the bounds. */
export class CloudwatchAnalysisSettings {
  /** What the metric is called in a failure (set by {@link name}). */
  name_?: string;
  /** The metric's namespace (set by {@link namespace}). */
  namespace_?: string;
  /** The metric's name (set by {@link metric}). */
  metric_?: string;
  /** The dimensions that pick the series (set by {@link dimension}). */
  readonly dimensions_: Array<[string, string]> = [];
  /** The statistic (set by {@link stat}). */
  stat_?: CloudwatchStatistic;
  /** The aggregation period in seconds (set by {@link period}). */
  period_: number = DEFAULT_PERIOD;
  /** The unit to filter on (set by {@link unit}). */
  unit_?: string;
  /** Further metrics an expression reads, by id (set by {@link metricStat}). */
  readonly metricStats_: Array<
    [string, Configure<CloudwatchMetricStatSettings>]
  > = [];
  /** The metric-math expression judged instead of the metric (set by {@link expression}). */
  expression_?: string;
  /** How far back to read, in ms (set by {@link window}). */
  window_: number = DEFAULT_WINDOW;
  /** The lowest acceptable value (set by {@link min}). */
  min_?: number;
  /** The highest acceptable value (set by {@link max}). */
  max_?: number;
  /** The value to judge when there are no datapoints (set by {@link missingDataAs}). */
  missingData_?: number;
  /** The named profile (set by {@link profile}). */
  profile_?: string;
  /** The region (set by {@link region}). */
  region_?: string;
  /** How the command is run (set by {@link runner}); spawned when unset. */
  runner_?: AwsSettingsRunner;
  /** Further global options (set by {@link aws}). */
  aws_: Configure<AwsSettings> = (a) => a;

  /** What to call the metric when it is out of bounds. */
  name(name: string): this {
    this.name_ = name;
    return this;
  }

  /** The metric's namespace, e.g. `"AWS/ApplicationELB"`. */
  namespace(value: string): this {
    this.namespace_ = value;
    return this;
  }

  /** The metric's name, e.g. `"HTTPCode_Target_5XX_Count"`. */
  metric(value: string): this {
    this.metric_ = value;
    return this;
  }

  /** A dimension that picks the series; repeatable. */
  dimension(name: string, value: string): this {
    this.dimensions_.push([name, value]);
    return this;
  }

  /** The statistic: `"Sum"`, `"Average"`, `"Maximum"`, `"p99"`, … */
  stat(value: CloudwatchStatistic): this {
    this.stat_ = value;
    return this;
  }

  /**
   * The aggregation period in seconds (default 60): each datapoint covers one
   * period, and each is judged.
   */
  period(seconds: number): this {
    this.period_ = seconds;
    return this;
  }

  /** Only datapoints published in this unit, e.g. `"Count"`. */
  unit(value: string): this {
    this.unit_ = value;
    return this;
  }

  /**
   * Add a metric for {@link expression} to read, under `id`. The metric set
   * with {@link namespace} and {@link metric} is `m1`.
   */
  metricStat(
    id: string,
    configure: Configure<CloudwatchMetricStatSettings>,
  ): this {
    this.metricStats_.push([id, configure]);
    return this;
  }

  /**
   * Judge a metric-math expression over the metrics instead of a metric —
   * `"100 * errors / requests"`, with `errors` and `requests` added by
   * {@link metricStat}.
   */
  expression(expression: string): this {
    this.expression_ = expression;
    return this;
  }

  /**
   * How far back to read (`"10m"`, or ms; default 5 minutes). The window ends
   * at the start of the current minute, so the minute still being written is
   * not judged.
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
   * Judge `value` when the window has no datapoints, instead of failing.
   * CloudWatch publishes nothing for a period with no events, so for a count
   * of errors no data means `0`; for a latency it usually means the metric or
   * its dimensions are wrong, which is why that is a failure by default.
   */
  missingDataAs(value: number): this {
    if (!Number.isFinite(value)) {
      throw new Error(
        `cloudwatch: missingDataAs needs a finite number, got ${value}.`,
      );
    }
    this.missingData_ = value;
    return this;
  }

  /** The named profile to read with (`--profile`). */
  profile(name: string): this {
    this.profile_ = name;
    return this;
  }

  /** The region the metric lives in (`--region`). */
  region(name: string): this {
    this.region_ = name;
    return this;
  }

  /**
   * Replace how the `get-metric-data` command is run — the seam a test
   * answers through. The default spawns the CLI.
   */
  runner(run: AwsSettingsRunner): this {
    this.runner_ = run;
    return this;
  }

  /**
   * Any other global option — `(a) => a.endpointUrl(url)`, a
   * `.toolPath(...)` — applied after {@link profile}, {@link region} and
   * {@link runner}.
   */
  aws(configure: Configure<AwsSettings>): this {
    this.aws_ = configure;
    return this;
  }
}

/** The label a failure names: the analysis's name, or what it reads. */
function labelOf(settings: CloudwatchAnalysisSettings): string {
  return settings.name_ ?? settings.expression_ ?? settings.metric_ ??
    "cloudwatch metric";
}

/**
 * The `get-metric-data` request `settings` describe, and the id of the series
 * it judges.
 */
function request(
  settings: CloudwatchAnalysisSettings,
  now: Date,
): { command: CloudwatchGetMetricDataSettings; id: string } {
  const command = new CloudwatchGetMetricDataSettings();
  const expression = settings.expression_;
  const hidden = expression !== undefined;
  const ids: string[] = [];
  if (settings.namespace_ !== undefined || settings.metric_ !== undefined) {
    command.metricStat(METRIC_ID, (m) => {
      if (settings.namespace_ !== undefined) m.namespace(settings.namespace_);
      if (settings.metric_ !== undefined) m.metricName(settings.metric_);
      if (settings.stat_ !== undefined) m.stat(settings.stat_);
      if (settings.unit_ !== undefined) m.unit(settings.unit_);
      for (const [name, value] of settings.dimensions_) {
        m.dimension(name, value);
      }
      return m.period(settings.period_).returnData(!hidden);
    });
    ids.push(METRIC_ID);
  }
  for (const [id, configure] of settings.metricStats_) {
    command.metricStat(id, (m) => configure(m).returnData(!hidden));
    ids.push(id);
  }
  if (expression !== undefined) {
    command.expression(EXPRESSION_ID, expression);
  } else if (ids.length !== 1) {
    throw new Error(
      `cloudwatch "${labelOf(settings)}" reads ${ids.length} metrics but ` +
        "judges one — name a metric with .namespace(...).metric(...), or " +
        "combine several with .expression(...).",
    );
  }
  const end = new Date(Math.floor(now.getTime() / MINUTE) * MINUTE);
  command.window(settings.window_, end);
  if (settings.profile_ !== undefined) command.profile(settings.profile_);
  if (settings.region_ !== undefined) command.region(settings.region_);
  if (settings.runner_ !== undefined) command.runner(settings.runner_);
  settings.aws_(command);
  command.quiet().output("json").query(METRIC_DATA_RESULTS_QUERY);
  return { command, id: expression === undefined ? ids[0] : EXPRESSION_ID };
}

/** The message of a thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run `step`, turning anything it throws into an `Error` whose message is
 * `prefix` and the original message, passed through the run's redactor.
 */
async function attempt<T>(
  context: CloudwatchAnalysisContext,
  prefix: string,
  step: () => T | Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    throw new Error(context.redact(`${prefix}${messageOf(error)}`));
  }
}

/**
 * An analysis that reads a CloudWatch metric over a recent window and fails
 * the canary when any datapoint is out of bounds — or when there is no data,
 * unless {@link CloudwatchAnalysisSettings.missingDataAs} says what no data
 * means. Each datapoint covers one period, so a `.max(5)` on a per-minute
 * `Sum` means "no minute with more than five".
 *
 * The lambda runs on each check, so it may read resolved parameters, and
 * every failure message passes through the run's redactor.
 */
export function cloudwatch(
  configure: Configure<CloudwatchAnalysisSettings>,
): CloudwatchAnalysis {
  return {
    name: "cloudwatch",
    async validate(context) {
      const settings = configure(new CloudwatchAnalysisSettings());
      const label = labelOf(settings);
      const bounds = await attempt(
        context,
        "",
        () => boundsOf(label, settings.min_, settings.max_),
      );
      const { command, id } = await attempt(
        context,
        "",
        () => request(settings, new Date()),
      );
      const datapoints = await attempt(
        context,
        `${label} could not be read: `,
        async () =>
          datapointsOf(readJson(await command.run(), TASK), id, TASK)
            .datapoints,
      );
      const judged = datapoints.map((point) => ({
        label: `${label} at ${point.timestamp.toISOString()}`,
        value: point.value,
      }));
      if (judged.length === 0) {
        const missing = settings.missingData_;
        if (missing === undefined) {
          throw new Error(context.redact(
            `${label} has no datapoints in the last ${settings.window_} ms — ` +
              "check the namespace, metric, dimensions and region, or call " +
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
