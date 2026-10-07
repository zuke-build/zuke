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
 *         .metricName("HTTPCode_Target_5XX_Count")
 *         .dimension("TargetGroup", "targetgroup/api-canary/0a1b")
 *         .stat("Sum").window("5m").max(5).missingDataAs(0)
 *         .aws((a) => a.region("eu-west-1"))
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
import { AwsCloudwatchGetMetricDataSettings } from "./cloudwatch.ts";
import { datapointsOf, METRIC_DATA_RESULTS_QUERY } from "./metric_data.ts";
import { AwsCloudwatchMetricStatSettings } from "./metric_query.ts";
import { jsonFrom } from "./reader.ts";
import type { AwsSettings } from "./settings.ts";
import { boundsOf, checkThreshold } from "./threshold.ts";
import { finite } from "./validate.ts";

/** The window read when none is set: the last five minutes. */
const DEFAULT_WINDOW = 5 * 60_000;

/** The id the analysis's own metric is queried under. */
const METRIC_ID = "m1";

/** The id the analysis's expression is queried under. */
const EXPRESSION_ID = "e1";

/** The task name in this analysis's errors. */
const TASK = "cloudwatch";

/**
 * The part of the canary engine's context the analysis uses: the run's
 * redactor, applied to every failure message. The engine hands a richer
 * context; this is the narrow view.
 */
export interface AwsCloudwatchAnalysisContext {
  /** Mask every resolved `secret` parameter in `text`. */
  redact(text: string): string;
}

/**
 * A health check run against a canary, in the shape `@zuke/canary`'s
 * `c.analysis(...)` accepts: throw to fail it, which rolls the rollout back.
 */
export interface AwsCloudwatchAnalysis {
  /** `"cloudwatch"`, for diagnostics. */
  readonly name: string;
  /** Read the metric and throw when a datapoint is out of bounds. */
  validate(context: AwsCloudwatchAnalysisContext): Promise<void>;
}

/**
 * Settings for {@link cloudwatch}: the metric, the window and the bounds.
 *
 * The metric itself — `namespace`, `metricName`, `dimension`, `stat`,
 * `period`, `unit` — is set with the same setters as a `get-metric-data`
 * query, which these settings extend; it is queried as `m1`.
 */
export class AwsCloudwatchAnalysisSettings
  extends AwsCloudwatchMetricStatSettings {
  /** What the metric is called in a failure (set by {@link name}). */
  name_?: string;
  /** Further metrics an expression reads, by id (set by {@link metricStat}). */
  readonly metricStats_: Array<
    [string, Configure<AwsCloudwatchMetricStatSettings>]
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
  /** Global options for the command (set by {@link aws}). */
  aws_: Configure<AwsSettings> = (a) => a;
  /** The clock the window is read against (set by {@link now}). */
  now_: () => Date = () => new Date();

  /** What to call the metric when it is out of bounds. */
  name(name: string): this {
    this.name_ = name;
    return this;
  }

  /**
   * Add a metric for {@link expression} to read, under `id`. The metric set
   * with {@link namespace} and {@link metricName} is `m1`.
   */
  metricStat(
    id: string,
    configure: Configure<AwsCloudwatchMetricStatSettings>,
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
   * How far back to read (`"10m"`, or ms; default 5 minutes). The window
   * ends at the last period boundary, so the period still being written is
   * not judged.
   *
   * CloudWatch publishes a datapoint a little after its period ends, so the
   * newest period in the window may still be short of some data. That only
   * lowers a `Sum` or a `SampleCount`: harmless for a `max`, but a `min` on
   * such a statistic can fail on a lag rather than on the candidate.
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
    this.missingData_ = finite("cloudwatch", "missingDataAs", value);
    return this;
  }

  /**
   * Global options for the `get-metric-data` command —
   * `(a) => a.profile("prod").region("eu-west-1")`, a `.toolPath(...)`, or a
   * `.runner(...)`, the seam a test answers through. `--output` and `--query`
   * are the analysis's own and are set after it.
   */
  aws(configure: Configure<AwsSettings>): this {
    this.aws_ = configure;
    return this;
  }

  /** The clock the window is read against — the seam a test pins it with. */
  now(clock: () => Date): this {
    this.now_ = clock;
    return this;
  }
}

/** The label a failure names: the analysis's name, or what it reads. */
function labelOf(settings: AwsCloudwatchAnalysisSettings): string {
  return settings.name_ ?? settings.expression_ ?? settings.metricName_ ??
    "cloudwatch metric";
}

/**
 * The `get-metric-data` request `settings` describe, and the id of the series
 * it judges.
 */
function request(
  settings: AwsCloudwatchAnalysisSettings,
  label: string,
): { command: AwsCloudwatchGetMetricDataSettings; id: string } {
  const command = new AwsCloudwatchGetMetricDataSettings();
  const expression = settings.expression_;
  const ids: string[] = [];
  if (settings.namespace_ !== undefined || settings.metricName_ !== undefined) {
    if (
      settings.namespace_ === undefined || settings.metricName_ === undefined ||
      settings.stat_ === undefined
    ) {
      throw new Error(
        `cloudwatch "${label}" needs a namespace, a metric name and a ` +
          "statistic — add .namespace(ns).metricName(name).stat('Sum').",
      );
    }
    // The settings are the metric's own: returned as they are, hiding the
    // series when an expression is what is judged.
    command.metricStat(
      METRIC_ID,
      () => settings.returnData(expression === undefined),
    );
    ids.push(METRIC_ID);
  }
  for (const [id, configure] of settings.metricStats_) {
    command.metricStat(
      id,
      (m) => configure(m).returnData(expression === undefined),
    );
    ids.push(id);
  }
  if (expression !== undefined) {
    command.expression(EXPRESSION_ID, expression);
  } else if (ids.length !== 1) {
    throw new Error(
      `cloudwatch "${label}" reads ${ids.length} metrics but judges one — ` +
        "name a metric with .namespace(...).metricName(...), or combine " +
        "several with .expression(...).",
    );
  }
  const period = settings.period_ * 1000;
  const end = Math.floor(settings.now_().getTime() / period) * period;
  command.window(settings.window_, new Date(end));
  settings.aws_(command);
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
  context: AwsCloudwatchAnalysisContext,
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
 * unless {@link AwsCloudwatchAnalysisSettings.missingDataAs} says what no
 * data means. Each datapoint covers one period, so a `.max(5)` on a
 * per-minute `Sum` means "no minute with more than five".
 *
 * The lambda runs on each check, so it may read resolved parameters, and
 * every failure message — one from the lambda included — passes through the
 * run's redactor.
 */
export function cloudwatch(
  configure: Configure<AwsCloudwatchAnalysisSettings>,
): AwsCloudwatchAnalysis {
  return {
    name: "cloudwatch",
    async validate(context) {
      const { settings, label, bounds, command, id } = await attempt(
        context,
        "",
        () => {
          const settings = configure(new AwsCloudwatchAnalysisSettings());
          const label = labelOf(settings);
          const bounds = boundsOf(label, settings.min_, settings.max_);
          return { settings, label, bounds, ...request(settings, label) };
        },
      );
      const datapoints = await attempt(
        context,
        `${label} could not be read: `,
        async () => {
          const document = await jsonFrom(
            command,
            TASK,
            METRIC_DATA_RESULTS_QUERY,
          );
          return datapointsOf(document, id, TASK).datapoints;
        },
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
