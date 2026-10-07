// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Metadata queries: series by matcher (`/api/v1/series`), label names
 * (`/api/v1/labels`), one label's values (`/api/v1/label/<label_name>/values`)
 * and metric metadata (`/api/v1/metadata`).
 *
 * @module
 */

import { PrometheusConnectionSettings } from "./connection.ts";
import { definedParams, formatCount, formatTime, nonEmpty } from "./params.ts";
import {
  readArray,
  readLabels,
  readRecord,
  readString,
  readStringArray,
} from "./shape.ts";
import type { PrometheusCall } from "./transport.ts";
import type {
  PrometheusHttpMethod,
  PrometheusLabels,
  PrometheusTime,
} from "./types.ts";

/** What the series, label-name and label-value endpoints share. */
export class PrometheusSelectionSettings extends PrometheusConnectionSettings {
  /** The series selectors (set by {@link match}), sent as repeated `match[]`. */
  readonly match_: string[] = [];
  /** The start time (set by {@link start}). */
  start_?: string;
  /** The end time (set by {@link end}). */
  end_?: string;
  /** The result limit (set by {@link limit}). */
  limit_?: string;

  /** Add series selectors (`match[]`), such as `up` or `{job="api"}`. */
  match(...selectors: string[]): this {
    for (const selector of selectors) {
      this.match_.push(nonEmpty(selector, "match(...)"));
    }
    return this;
  }

  /** The start time (`start`): a `Date`, Unix seconds, or RFC 3339 text. */
  start(time: PrometheusTime): this {
    this.start_ = formatTime(time, "start(...)");
    return this;
  }

  /** The end time (`end`): a `Date`, Unix seconds, or RFC 3339 text. */
  end(time: PrometheusTime): this {
    this.end_ = formatTime(time, "end(...)");
    return this;
  }

  /** The most results to return (`limit`); `0` means no limit. */
  limit(count: number): this {
    this.limit_ = formatCount(count, "limit(...)");
    return this;
  }
}

/** Settings for finding series by matchers (`/api/v1/series`). */
export class PrometheusSeriesSettings extends PrometheusSelectionSettings {
  /** The HTTP method (set by {@link httpMethod}); `POST` by default. */
  httpMethod_: PrometheusHttpMethod = "POST";

  /** Send the parameters as a `POST` form (the default) or in a `GET` URL. */
  httpMethod(method: PrometheusHttpMethod): this {
    this.httpMethod_ = method;
    return this;
  }
}

/** Settings for listing label names (`/api/v1/labels`). */
export class PrometheusLabelsSettings extends PrometheusSelectionSettings {
  /** The HTTP method (set by {@link httpMethod}); `POST` by default. */
  httpMethod_: PrometheusHttpMethod = "POST";

  /** Send the parameters as a `POST` form (the default) or in a `GET` URL. */
  httpMethod(method: PrometheusHttpMethod): this {
    this.httpMethod_ = method;
    return this;
  }
}

/** Settings for one label's values (`/api/v1/label/<label_name>/values`). */
export class PrometheusLabelValuesSettings extends PrometheusSelectionSettings {
  /** The label whose values to list (set by {@link labelName}). */
  labelName_?: string;

  /**
   * The label whose values to list. Any name is accepted: one outside the
   * classic `[a-zA-Z_:][a-zA-Z0-9_:]*` form (a UTF-8 name such as
   * `http.status_code`) is sent in the API's `U__` value-encoding escape, so
   * nothing in the name can reach the URL path as a separator.
   */
  labelName(name: string): this {
    this.labelName_ = nonEmpty(name, "labelName(...)");
    return this;
  }
}

/** Settings for metric metadata (`/api/v1/metadata`). */
export class PrometheusMetadataSettings extends PrometheusConnectionSettings {
  /** The metric limit (set by {@link limit}). */
  limit_?: string;
  /** The per-metric limit (set by {@link limitPerMetric}). */
  limitPerMetric_?: string;
  /** The metric to filter for (set by {@link metric}). */
  metric_?: string;

  /** The most metrics to return (`limit`). */
  limit(metrics: number): this {
    this.limit_ = formatCount(metrics, "limit(...)");
    return this;
  }

  /** The most metadata entries per metric (`limit_per_metric`). */
  limitPerMetric(entries: number): this {
    this.limitPerMetric_ = formatCount(entries, "limitPerMetric(...)");
    return this;
  }

  /** Only this metric's metadata (`metric`). */
  metric(name: string): this {
    this.metric_ = nonEmpty(name, "metric(...)");
    return this;
  }
}

/** One metadata entry for a metric, as scraped from a target. */
export interface PrometheusMetricMetadata {
  /** The metric type: `counter`, `gauge`, `histogram`, `summary`, `unknown`, … */
  readonly type: string;
  /** The `# HELP` text. */
  readonly help: string;
  /** The unit, or `""`. */
  readonly unit: string;
}

/**
 * A name as the API's `/api/v1/label/<label_name>/values` path segment: as
 * is when it is a classic name, otherwise in the `U__` value-encoding escape
 * — exactly `model.EscapeName(name, model.ValueEncodingEscaping)` from
 * `prometheus/common`, which the server reverses.
 *
 * The escape is also the path guard. Its output only ever contains
 * `[A-Za-z0-9_:]`, so a name such as `../../admin` or `%2e%2e` becomes an
 * inert segment (`U___2e__2e__2f_…`) rather than a traversal — there is no
 * character left that a URL parser would treat as structure.
 */
export function escapeLabelName(name: string): string {
  if (/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) return name;
  let escaped = "U__";
  let index = 0;
  for (const character of name) {
    // Iteration yields a surrogate pair as one two-unit character and a lone
    // surrogate as a one-unit one, so the code point is read from the units.
    const code = character.length === 2
      ? (character.charCodeAt(0) - 0xd800) * 0x400 +
        (character.charCodeAt(1) - 0xdc00) + 0x10000
      : character.charCodeAt(0);
    if (character === "_") {
      escaped += "__";
    } else if (
      /^[a-zA-Z:]$/.test(character) || (index > 0 && /^[0-9]$/.test(character))
    ) {
      escaped += character;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      // A lone surrogate is not a valid rune; Go writes the replacement.
      escaped += "_FFFD_";
    } else {
      escaped += `_${code.toString(16)}_`;
    }
    index += character.length;
  }
  return escaped;
}

/** The `/api/v1/series` call the settings describe. */
export function seriesCall(settings: PrometheusSeriesSettings): PrometheusCall {
  if (settings.match_.length === 0) {
    throw new Error(
      "a Prometheus series lookup needs at least one selector — call " +
        "s.match(...).",
    );
  }
  return {
    method: settings.httpMethod_,
    path: "/api/v1/series",
    params: selectionParams(settings),
  };
}

/** The `/api/v1/labels` call the settings describe. */
export function labelsCall(settings: PrometheusLabelsSettings): PrometheusCall {
  return {
    method: settings.httpMethod_,
    path: "/api/v1/labels",
    params: selectionParams(settings),
  };
}

/** The `/api/v1/label/<label_name>/values` call the settings describe. */
export function labelValuesCall(
  settings: PrometheusLabelValuesSettings,
): PrometheusCall {
  if (settings.labelName_ === undefined) {
    throw new Error(
      "a Prometheus label-values lookup needs the label — call " +
        "s.labelName(...).",
    );
  }
  return {
    method: "GET",
    path: `/api/v1/label/${escapeLabelName(settings.labelName_)}/values`,
    params: selectionParams(settings),
  };
}

/** The `/api/v1/metadata` call the settings describe. */
export function metadataCall(
  settings: PrometheusMetadataSettings,
): PrometheusCall {
  return {
    method: "GET",
    path: "/api/v1/metadata",
    params: definedParams([
      ["limit", settings.limit_],
      ["limit_per_metric", settings.limitPerMetric_],
      ["metric", settings.metric_],
    ]),
  };
}

/** The selection parameters, `match[]` repeated once per selector. */
function selectionParams(
  settings: PrometheusSelectionSettings,
): Array<[string, string]> {
  return [
    ...settings.match_.map((selector): [string, string] => [
      "match[]",
      selector,
    ]),
    ...definedParams([
      ["start", settings.start_],
      ["end", settings.end_],
      ["limit", settings.limit_],
    ]),
  ];
}

/** The series endpoint's data: one label set per series. */
export function parseSeriesData(data: unknown): PrometheusLabels[] {
  return readArray(data, "the series data")
    .map((series) => readLabels(series, "a series"));
}

/** The label endpoints' data: a list of names or values. */
export function parseStringList(data: unknown): string[] {
  return readStringArray(data, "the data");
}

/** The metadata endpoint's data: metric name to its metadata entries. */
export function parseMetadataData(
  data: unknown,
): Readonly<Record<string, readonly PrometheusMetricMetadata[]>> {
  const object = readRecord(data, "the metadata");
  return Object.fromEntries(
    Object.entries(object).map(([metric, entries]) => [
      metric,
      readArray(entries, `the metadata of ${metric}`).map((entry) => {
        const what = `a metadata entry of ${metric}`;
        const record = readRecord(entry, what);
        return {
          type: readString(record, "type", what),
          help: readString(record, "help", what),
          unit: readString(record, "unit", what),
        };
      }),
    ]),
  );
}
