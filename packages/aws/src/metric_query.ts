// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The typed input to `aws cloudwatch get-metric-data`: one
 * {@link CloudwatchMetricStatSettings} per metric and one
 * {@link CloudwatchExpressionSettings} per metric-math expression, rendered
 * to the `--metric-data-queries` JSON document by the CLI's own field names.
 *
 * @module
 */

/**
 * A CloudWatch statistic: one of the five basic statistics, or a percentile
 * (`p99`, `p99.9`) or other extended statistic (`tm90`, `TM(10%:90%)`, …).
 */
export type CloudwatchStatistic =
  | "SampleCount"
  | "Average"
  | "Sum"
  | "Minimum"
  | "Maximum"
  | `p${number}`
  | `${"tm" | "wm" | "tc" | "ts" | "pr"}${string}`
  | `${"TM" | "WM" | "TC" | "TS" | "PR"}(${string})`;

/** The period CloudWatch aggregates over when none is set, in seconds. */
export const DEFAULT_PERIOD = 60;

/** A query id as CloudWatch allows it: a lowercase letter, then letters, digits, `_`. */
const ID_SHAPE = /^[a-z][a-zA-Z0-9_]*$/;

/** Settings for one metric in a `get-metric-data` request (a `MetricStat` query). */
export class CloudwatchMetricStatSettings {
  /** The metric's namespace, e.g. `AWS/ApplicationELB` (set by {@link namespace}). */
  namespace_?: string;
  /** The metric's name (set by {@link metricName}). */
  metricName_?: string;
  /** The dimensions that pick the series, in order (set by {@link dimension}). */
  readonly dimensions_: Array<{ Name: string; Value: string }> = [];
  /** The aggregation period in seconds (set by {@link period}). */
  period_: number = DEFAULT_PERIOD;
  /** The statistic (set by {@link stat}). */
  stat_?: CloudwatchStatistic;
  /** The unit to filter on (set by {@link unit}). */
  unit_?: string;
  /** A label for the series (set by {@link label}). */
  label_?: string;
  /** Whether the response carries this series (set by {@link returnData}). */
  returnData_ = true;

  /** The metric's namespace, e.g. `"AWS/ApplicationELB"`. */
  namespace(value: string): this {
    this.namespace_ = value;
    return this;
  }

  /** The metric's name, e.g. `"HTTPCode_Target_5XX_Count"`. */
  metricName(value: string): this {
    this.metricName_ = value;
    return this;
  }

  /** A dimension that picks the series, e.g. `("LoadBalancer", "app/web/1f2e")`; repeatable. */
  dimension(name: string, value: string): this {
    this.dimensions_.push({ Name: name, Value: value });
    return this;
  }

  /**
   * The aggregation period in seconds (default 60). CloudWatch accepts 1, 5,
   * 10, 30, or a multiple of 60.
   */
  period(seconds: number): this {
    this.period_ = seconds;
    return this;
  }

  /** The statistic: `"Sum"`, `"Average"`, `"Maximum"`, `"p99"`, … */
  stat(value: CloudwatchStatistic): this {
    this.stat_ = value;
    return this;
  }

  /** Only datapoints published in this unit, e.g. `"Count"`. */
  unit(value: string): this {
    this.unit_ = value;
    return this;
  }

  /** A label for the series in the response. */
  label(text: string): this {
    this.label_ = text;
    return this;
  }

  /**
   * Whether the response carries this series (default `true`). Pass `false`
   * for a metric that only feeds an expression.
   */
  returnData(value: boolean): this {
    this.returnData_ = value;
    return this;
  }
}

/** Settings for one metric-math expression in a `get-metric-data` request. */
export class CloudwatchExpressionSettings {
  /** A label for the series (set by {@link label}). */
  label_?: string;
  /** The period in seconds, for an expression that needs one (set by {@link period}). */
  period_?: number;
  /** Whether the response carries this series (set by {@link returnData}). */
  returnData_ = true;

  /** A label for the series in the response. */
  label(text: string): this {
    this.label_ = text;
    return this;
  }

  /** The period in seconds, for an expression that has no metric to take it from. */
  period(seconds: number): this {
    this.period_ = seconds;
    return this;
  }

  /** Whether the response carries this series (default `true`). */
  returnData(value: boolean): this {
    this.returnData_ = value;
    return this;
  }
}

/** One entry of `--metric-data-queries`, by the API's field names. */
export type MetricDataQuery = Record<string, unknown>;

/** Refuse an id CloudWatch would refuse, before the request is sent. */
export function checkQueryId(task: string, id: string): void {
  if (!ID_SHAPE.test(id)) {
    throw new Error(
      `AwsTasks.${task}: "${id}" is not a CloudWatch query id — an id starts ` +
        "with a lowercase letter, followed by letters, digits or '_'.",
    );
  }
}

/** The `MetricStat` query `settings` describe, under `id`. */
export function metricStatQuery(
  task: string,
  id: string,
  settings: CloudwatchMetricStatSettings,
): MetricDataQuery {
  checkQueryId(task, id);
  const { namespace_, metricName_, stat_ } = settings;
  if (
    namespace_ === undefined || metricName_ === undefined ||
    stat_ === undefined
  ) {
    throw new Error(
      `AwsTasks.${task}: metric "${id}" needs a namespace, a metric name and ` +
        "a statistic — add .namespace(ns).metricName(name).stat('Sum').",
    );
  }
  return {
    Id: id,
    MetricStat: {
      Metric: {
        Namespace: namespace_,
        MetricName: metricName_,
        Dimensions: settings.dimensions_,
      },
      Period: settings.period_,
      Stat: stat_,
      ...(settings.unit_ === undefined ? {} : { Unit: settings.unit_ }),
    },
    ...(settings.label_ === undefined ? {} : { Label: settings.label_ }),
    ReturnData: settings.returnData_,
  };
}

/** The expression query `settings` describe, under `id`. */
export function expressionQuery(
  task: string,
  id: string,
  expression: string,
  settings: CloudwatchExpressionSettings,
): MetricDataQuery {
  checkQueryId(task, id);
  return {
    Id: id,
    Expression: expression,
    ...(settings.label_ === undefined ? {} : { Label: settings.label_ }),
    ...(settings.period_ === undefined ? {} : { Period: settings.period_ }),
    ReturnData: settings.returnData_,
  };
}
