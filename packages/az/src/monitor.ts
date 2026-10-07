// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az monitor` — Azure Monitor: reading a resource's metrics and their
 * definitions, its metric alert rules, and the activity log.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * const errors = await AzTasks.metricValue((s) =>
 *   s.resource(appId).metrics("Requests").aggregation("Total")
 *     .dimension("statusCodeCategory", "5xx").window("15m")
 *     .aggregate("sum").missingDataAs(0)
 * );
 * ```
 *
 * @module
 */

import { AzResourceSettings } from "./resource.ts";
import { AzSettings } from "./settings.ts";
import { type AzTime, iso, shorthandDuration, windowEnding } from "./time.ts";
import { operands, option, required } from "./validate.ts";
import { parseDuration } from "@zuke/core";

/**
 * The time grains `metrics list --interval` takes, in ISO 8601 — the form the
 * CLI passes through unchanged. (Its `##h##m` shorthand writes a mixed
 * duration such as `1h30m` in the wrong order, so it is not offered.)
 */
export type AzMonitorInterval =
  | "PT1M"
  | "PT5M"
  | "PT15M"
  | "PT30M"
  | "PT1H"
  | "PT6H"
  | "PT12H"
  | "PT24H";

/** Each {@link AzMonitorInterval} in milliseconds. */
export const INTERVAL_MS: Record<AzMonitorInterval, number> = {
  PT1M: 60_000,
  PT5M: 300_000,
  PT15M: 900_000,
  PT30M: 1_800_000,
  PT1H: 3_600_000,
  PT6H: 21_600_000,
  PT12H: 43_200_000,
  PT24H: 86_400_000,
};

/** The aggregations Azure Monitor computes per interval (`--aggregation`). */
export type AzMonitorAggregation =
  | "Average"
  | "Count"
  | "Maximum"
  | "Minimum"
  | "Total";

/** A dimension value written as an OData string literal: `'` doubled. */
function odataString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Settings for `az monitor metrics list`: a resource's metrics over a time
 * range, one datapoint per interval.
 *
 * The CLI returns at most {@link top} time series per metric — ten unless
 * told otherwise — so a query that splits by a dimension can silently lose
 * series; raise `top` to cover them.
 */
export class AzMonitorMetricsListSettings extends AzSettings {
  #resource?: string;
  readonly #metrics: string[] = [];
  /** The aggregations to compute (set by {@link aggregation}). */
  readonly aggregations_: AzMonitorAggregation[] = [];
  /** The time grain (set by {@link interval}). */
  interval_?: AzMonitorInterval;
  #start?: AzTime;
  #end?: AzTime;
  #offset?: string;
  #filter?: string;
  readonly #dimensionFilters: string[] = [];
  /** The dimensions the series are split by (set by {@link splitBy}). */
  readonly splitBy_: string[] = [];
  #namespace?: string;
  /** The most series per metric (set by {@link top}). */
  top_?: number;
  #orderby?: string;

  /** The task name used in this command's error messages. */
  protected taskName(): string {
    return "monitorMetricsList";
  }

  /** The resource, by full resource id (`--resource`). */
  resource(id: string): this {
    this.#resource = id;
    return this;
  }

  /** The metrics to read, by name (`--metrics`); repeatable. */
  metrics(...names: string[]): this {
    this.#metrics.push(...names);
    return this;
  }

  /** The aggregations to compute per interval (`--aggregation`); repeatable. */
  aggregation(...types: AzMonitorAggregation[]): this {
    this.aggregations_.push(...types);
    return this;
  }

  /** The time grain of each datapoint (`--interval`); one minute by default. */
  interval(interval: AzMonitorInterval): this {
    this.interval_ = interval;
    return this;
  }

  /** The start of the range (`--start-time`). */
  startTime(time: AzTime): this {
    this.#start = time;
    return this;
  }

  /** The end of the range (`--end-time`); now by default. */
  endTime(time: AzTime): this {
    this.#end = time;
    return this;
  }

  /**
   * The `duration` (`"15m"`, or milliseconds) up to `end` — now, unless
   * given — as `--start-time` and `--end-time`.
   */
  window(duration: string | number, end: Date = new Date()): this {
    const range = windowEnding(duration, end);
    this.#start = range.start;
    this.#end = range.end;
    return this;
  }

  /**
   * The length of the range when only one end is given (`--offset`, as
   * `"30m"` or milliseconds); an hour by default.
   */
  offset(duration: string | number): this {
    this.#offset = shorthandDuration(parseDuration(duration));
    return this;
  }

  /**
   * An OData filter on the dimensions (`--filter`), e.g.
   * `"ApiName eq 'GetBlob' and GeoType eq '*'"`. For plain equality, prefer
   * {@link dimension}, which quotes the value.
   */
  filter(expression: string): this {
    this.#filter = expression;
    return this;
  }

  /**
   * Only the series where the dimension `name` is `value` — rendered into
   * `--filter` as `name eq 'value'`, joined with `and`; repeatable.
   */
  dimension(name: string, value: string): this {
    this.#dimensionFilters.push(`${name} eq ${odataString(value)}`);
    return this;
  }

  /** Split the series by these dimensions (`--dimension`); repeatable. */
  splitBy(...dimensions: string[]): this {
    this.splitBy_.push(...dimensions);
    return this;
  }

  /** The metric namespace (`--namespace`). */
  namespace(namespace: string): this {
    this.#namespace = namespace;
    return this;
  }

  /** The most time series to return per metric (`--top`); 10 by default. */
  top(count: number): this {
    this.top_ = count;
    return this;
  }

  /** The aggregation and direction to sort series by (`--orderby`), e.g. `"sum desc"`. */
  orderby(order: string): this {
    this.#orderby = order;
    return this;
  }

  /** The `--filter` to send, refused when the CLI would reject the combination. */
  #filterExpression(task: string): string | undefined {
    const sources = [
      this.#filter !== undefined,
      this.#dimensionFilters.length > 0,
      this.splitBy_.length > 0,
    ].filter(Boolean).length;
    if (sources > 1) {
      throw new Error(
        `AzTasks.${task}: use one of .filter(...), .dimension(...) and ` +
          ".splitBy(...) — the CLI takes --dimension and --filter only apart.",
      );
    }
    return this.#dimensionFilters.length > 0
      ? this.#dimensionFilters.join(" and ")
      : this.#filter;
  }

  /** Emit `monitor metrics list` with its options. */
  protected override leadingTokens(): string[] {
    const task = this.taskName();
    const resource = required(
      this.#resource,
      task,
      "no resource — add .resource(resourceId).",
    );
    const argv = ["monitor", "metrics", "list", option("--resource", resource)];
    if (this.#metrics.length > 0) {
      argv.push("--metrics", ...operands(task, "--metrics", this.#metrics));
    }
    if (this.aggregations_.length > 0) {
      argv.push("--aggregation", ...this.aggregations_);
    }
    if (this.interval_ !== undefined) {
      argv.push(option("--interval", this.interval_));
    }
    if (this.#start !== undefined) {
      argv.push(option("--start-time", iso(this.#start)));
    }
    if (this.#end !== undefined) {
      argv.push(option("--end-time", iso(this.#end)));
    }
    if (this.#offset !== undefined) argv.push(option("--offset", this.#offset));
    const filter = this.#filterExpression(task);
    if (filter !== undefined) argv.push(option("--filter", filter));
    if (this.splitBy_.length > 0) {
      argv.push("--dimension", ...operands(task, "--dimension", this.splitBy_));
    }
    if (this.#namespace !== undefined) {
      argv.push(option("--namespace", this.#namespace));
    }
    if (this.top_ !== undefined) argv.push(option("--top", this.top_));
    if (this.#orderby !== undefined) {
      argv.push(option("--orderby", this.#orderby));
    }
    return argv;
  }
}

/** Settings for `az monitor metrics list-definitions`: the metrics a resource has. */
export class AzMonitorMetricsListDefinitionsSettings extends AzSettings {
  #resource?: string;
  #namespace?: string;

  /** The resource, by full resource id (`--resource`). */
  resource(id: string): this {
    this.#resource = id;
    return this;
  }

  /** Only this metric namespace (`--namespace`). */
  namespace(namespace: string): this {
    this.#namespace = namespace;
    return this;
  }

  /** Emit `monitor metrics list-definitions` with its options. */
  protected override leadingTokens(): string[] {
    const resource = required(
      this.#resource,
      "monitorMetricsListDefinitions",
      "no resource — add .resource(resourceId).",
    );
    const argv = [
      "monitor",
      "metrics",
      "list-definitions",
      option("--resource", resource),
    ];
    if (this.#namespace !== undefined) {
      argv.push(option("--namespace", this.#namespace));
    }
    return argv;
  }
}

/** Settings for `az monitor metrics alert list`. */
export class AzMonitorMetricsAlertListSettings extends AzSettings {
  #resourceGroup?: string;

  /** Only the rules in this resource group (`--resource-group`). */
  resourceGroup(name: string): this {
    this.#resourceGroup = name;
    return this;
  }

  /** Emit `monitor metrics alert list` with its options. */
  protected override leadingTokens(): string[] {
    const argv = ["monitor", "metrics", "alert", "list"];
    if (this.#resourceGroup !== undefined) {
      argv.push(option("--resource-group", this.#resourceGroup));
    }
    return argv;
  }
}

/**
 * Settings for `az monitor metrics alert show`: one metric alert rule. The
 * rule's definition, not whether it is firing — that lives in Azure Monitor's
 * alerts, not in the rule.
 */
export class AzMonitorMetricsAlertShowSettings extends AzResourceSettings {
  /** Emit `monitor metrics alert show`. */
  protected override leadingTokens(): string[] {
    return [
      "monitor",
      "metrics",
      "alert",
      "show",
      ...this.resourceTokens("monitorMetricsAlertShow", "alert rule"),
    ];
  }
}

/**
 * Settings for `az monitor activity-log list`: the control-plane events of a
 * subscription, resource group or resource. The CLI returns at most
 * {@link maxEvents} — 50 unless told otherwise.
 */
export class AzMonitorActivityLogListSettings extends AzSettings {
  #start?: AzTime;
  #end?: AzTime;
  #offset?: string;
  #resourceGroup?: string;
  #resourceId?: string;
  #namespace?: string;
  #caller?: string;
  #status?: string;
  #correlationId?: string;
  #maxEvents?: number;
  readonly #select: string[] = [];

  /** The start of the range (`--start-time`). */
  startTime(time: AzTime): this {
    this.#start = time;
    return this;
  }

  /** The end of the range (`--end-time`); now by default. */
  endTime(time: AzTime): this {
    this.#end = time;
    return this;
  }

  /** The length of the range when only one end is given (`--offset`); six hours by default. */
  offset(duration: string | number): this {
    this.#offset = shorthandDuration(parseDuration(duration));
    return this;
  }

  /** Only events in this resource group (`--resource-group`). */
  resourceGroup(name: string): this {
    this.#resourceGroup = name;
    return this;
  }

  /** Only events on this resource (`--resource-id`). */
  resourceId(id: string): this {
    this.#resourceId = id;
    return this;
  }

  /** Only events from this resource provider (`--namespace`). */
  namespace(namespace: string): this {
    this.#namespace = namespace;
    return this;
  }

  /** Only events by this caller (`--caller`). */
  caller(caller: string): this {
    this.#caller = caller;
    return this;
  }

  /** Only events with this status, e.g. `"Failed"` (`--status`). */
  status(status: string): this {
    this.#status = status;
    return this;
  }

  /** Only the events of this operation (`--correlation-id`). */
  correlationId(id: string): this {
    this.#correlationId = id;
    return this;
  }

  /** The most events to return (`--max-events`); 50 by default. */
  maxEvents(count: number): this {
    this.#maxEvents = count;
    return this;
  }

  /** Only these properties of each event (`--select`); repeatable. */
  select(...properties: string[]): this {
    this.#select.push(...properties);
    return this;
  }

  /** Emit `monitor activity-log list` with its options. */
  protected override leadingTokens(): string[] {
    const argv = ["monitor", "activity-log", "list"];
    if (this.#start !== undefined) {
      argv.push(option("--start-time", iso(this.#start)));
    }
    if (this.#end !== undefined) {
      argv.push(option("--end-time", iso(this.#end)));
    }
    if (this.#offset !== undefined) argv.push(option("--offset", this.#offset));
    if (this.#resourceGroup !== undefined) {
      argv.push(option("--resource-group", this.#resourceGroup));
    }
    if (this.#resourceId !== undefined) {
      argv.push(option("--resource-id", this.#resourceId));
    }
    if (this.#namespace !== undefined) {
      argv.push(option("--namespace", this.#namespace));
    }
    if (this.#caller !== undefined) argv.push(option("--caller", this.#caller));
    if (this.#status !== undefined) argv.push(option("--status", this.#status));
    if (this.#correlationId !== undefined) {
      argv.push(option("--correlation-id", this.#correlationId));
    }
    if (this.#maxEvents !== undefined) {
      argv.push(option("--max-events", this.#maxEvents));
    }
    if (this.#select.length > 0) {
      argv.push(
        "--select",
        ...operands("monitorActivityLogList", "--select", this.#select),
      );
    }
    return argv;
  }
}
