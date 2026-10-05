// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `metricThreshold(...)`: fail a canary when a number you read is out of
 * bounds — and the bounds check `prometheus(...)` shares.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { messageOf } from "./message.ts";
import { withoutCredentials } from "./request.ts";
import type { CanaryAnalysis, CanaryAnalysisContext } from "./types.ts";

/** Reads the metric a {@link metricThreshold} judges. */
export type MetricReader = (
  context: CanaryAnalysisContext,
) => number | Promise<number>;

/** Inclusive bounds a metric must stay within; either side may be open. */
export interface ThresholdBounds {
  /** The lowest acceptable value, if any. */
  min?: number;
  /** The highest acceptable value, if any. */
  max?: number;
}

/**
 * Settings for {@link metricThreshold}: a name, a reader, and the bounds the
 * value must stay within.
 */
export class MetricThresholdSettings {
  /** What the metric is called in a failure (set by {@link name}). */
  name_ = "metric";
  /** How to read the value (set by {@link read}). */
  read_?: MetricReader;
  /** The lowest acceptable value (set by {@link min}). */
  min_?: number;
  /** The highest acceptable value (set by {@link max}). */
  max_?: number;

  /** What to call the metric when it is out of bounds. */
  name(name: string): this {
    this.name_ = name;
    return this;
  }

  /** How to read the value — handed where the rollout stands. */
  read(reader: MetricReader): this {
    this.read_ = reader;
    return this;
  }

  /** Fail when the value is below `value`. */
  min(value: number): this {
    this.min_ = value;
    return this;
  }

  /** Fail when the value is above `value`. */
  max(value: number): this {
    this.max_ = value;
    return this;
  }
}

/**
 * An analysis that reads a number and fails the canary when it is out of
 * bounds:
 *
 * ```ts
 * metricThreshold((m) =>
 *   m.name("error ratio").read(() => readErrorRatio()).max(0.01)
 * )
 * ```
 *
 * The lambda runs on each check, so a reader may use resolved parameters.
 */
export function metricThreshold(
  configure: Configure<MetricThresholdSettings>,
): CanaryAnalysis {
  return {
    name: "metricThreshold",
    async validate(context) {
      const settings = configure(new MetricThresholdSettings());
      const read = settings.read_;
      if (read === undefined) {
        throw new Error(
          `metricThreshold "${settings.name_}" has no reader — call m.read(...).`,
        );
      }
      try {
        checkThreshold(settings.name_, await read(context), boundsOf(settings));
      } catch (error) {
        throw new Error(withoutCredentials(context.redact(messageOf(error))));
      }
    },
  };
}

/** The bounds a settings object set, refusing one that set none. */
export function boundsOf(
  settings: { name_: string; min_?: number; max_?: number },
): ThresholdBounds {
  if (settings.min_ === undefined && settings.max_ === undefined) {
    throw new Error(
      `"${settings.name_}" sets no bound — call .min(...) or .max(...).`,
    );
  }
  // A NaN bound compares false both ways and would pass every reading.
  for (const bound of [settings.min_, settings.max_]) {
    if (bound !== undefined && Number.isNaN(bound)) {
      throw new Error(`"${settings.name_}" has a bound that is not a number.`);
    }
  }
  if (
    settings.min_ !== undefined && settings.max_ !== undefined &&
    settings.min_ > settings.max_
  ) {
    throw new Error(
      `"${settings.name_}" can never pass: its minimum ${settings.min_} is ` +
        `above its maximum ${settings.max_}.`,
    );
  }
  return {
    ...(settings.min_ === undefined ? {} : { min: settings.min_ }),
    ...(settings.max_ === undefined ? {} : { max: settings.max_ }),
  };
}

/** Throw when `value` is not a number within `bounds`, naming the metric. */
export function checkThreshold(
  label: string,
  value: number,
  bounds: ThresholdBounds,
): void {
  if (Number.isNaN(value)) throw new Error(`${label} is not a number (NaN).`);
  if (bounds.max !== undefined && value > bounds.max) {
    throw new Error(`${label} is ${value}, above the maximum ${bounds.max}.`);
  }
  if (bounds.min !== undefined && value < bounds.min) {
    throw new Error(`${label} is ${value}, below the minimum ${bounds.min}.`);
  }
}
