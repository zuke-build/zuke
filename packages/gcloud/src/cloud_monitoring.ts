// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `CloudMonitoringTasks` — read Cloud Monitoring time series over its REST
 * API (`projects.timeSeries.list`), without a Google SDK. gcloud has no
 * command that reads a metric's data, on any release track, so this is the
 * way a build reads one. Auth is the same bearer token {@link "./gcs.ts".GcsTasks}
 * and {@link "./secret_manager.ts".SecretManagerTasks} use — by default
 * `gcloud auth print-access-token`.
 *
 * ```ts
 * import { CloudMonitoringTasks } from "@zuke/gcloud";
 *
 * const errors = await CloudMonitoringTasks.metricValue((s) =>
 *   s.project("my-proj")
 *     .metricType("run.googleapis.com/request_count")
 *     .resourceType("cloud_run_revision")
 *     .resourceLabel("service_name", "api")
 *     .metricLabel("response_code_class", "5xx")
 *     .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
 *     .crossSeriesReducer("REDUCE_SUM")
 *     .window("15m").aggregate("sum").missingDataAs(0)
 * );
 * ```
 *
 * The MQL method, `projects.timeSeries.query`, is deprecated by Google in
 * favour of PromQL and is not wrapped.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { gcloudAccessToken, resolveAccessToken } from "./auth.ts";
import { GcloudTasks } from "./gcloud.ts";
import {
  CloudMonitoringMetricValueSettings,
  metricValueOf,
} from "./metric_value.ts";
import { gcpJson } from "./rest.ts";
import {
  type CloudMonitoringTimeSeries,
  timeSeriesPageOf,
} from "./time_series.ts";
import {
  CloudMonitoringTimeSeriesSettings,
  DEFAULT_MAX_PAGES,
  type TimeSeriesQuery,
  timeSeriesRequest,
} from "./time_series_settings.ts";

/** The shape of {@link CloudMonitoringTasks}. */
export interface CloudMonitoringTasksApi {
  /**
   * Read the time series the settings describe, every page of them. A
   * series can arrive split across two pages; each part is returned as the
   * API sent it. Fails when the read still has a next page after
   * `.maxPages(n)` pages, rather than return part of the answer.
   */
  timeSeriesList(
    configure?: Configure<CloudMonitoringTimeSeriesSettings>,
  ): Promise<CloudMonitoringTimeSeries[]>;

  /**
   * One number from the time series the settings describe: the latest
   * value, or an aggregate of every point in the window.
   */
  metricValue(
    configure?: Configure<CloudMonitoringMetricValueSettings>,
  ): Promise<number>;
}

/**
 * The bearer token for `settings`: the explicit one, the provider's, or
 * `gcloud auth print-access-token` run with the settings' `.gcloud(...)`
 * flags — through the instance that lambda returns.
 */
function tokenOf(settings: CloudMonitoringTimeSeriesSettings): Promise<string> {
  return resolveAccessToken({
    token: settings.token_,
    tokenProvider: settings.tokenProvider_ ??
      (() =>
        gcloudAccessToken((configure) =>
          GcloudTasks.run((s) => {
            const scoped = settings.gcloud_(s);
            return configure === undefined ? scoped : configure(scoped);
          })
        )),
  });
}

/**
 * Every series the settings describe, following `nextPageToken` until the
 * last page — and failing, not truncating, when there are more pages than
 * `.maxPages(n)` allows. `query` narrows the filter beyond the settings' own,
 * fixes the interval, and carries a signal that aborts the read between
 * pages and in flight.
 */
export async function readTimeSeries(
  settings: CloudMonitoringTimeSeriesSettings,
  task: string,
  query: TimeSeriesQuery = {},
): Promise<CloudMonitoringTimeSeries[]> {
  const { signal } = query;
  const url = timeSeriesRequest(settings, task, query);
  signal?.throwIfAborted();
  const token = await tokenOf(settings);
  const series: CloudMonitoringTimeSeries[] = [];
  const maxPages = settings.maxPages_ ?? DEFAULT_MAX_PAGES;
  for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted();
    const body = await gcpJson(url.href, { method: "GET", signal }, {
      token,
      fetch: settings.fetch_,
    });
    const parsed = timeSeriesPageOf(body, task);
    // Pushed one at a time: spreading a large page into push() is one
    // argument per series, and enough of them overflow the call stack.
    for (const one of parsed.series) series.push(one);
    if (parsed.nextPageToken === undefined) return series;
    url.searchParams.set("pageToken", parsed.nextPageToken);
  }
  throw new Error(
    `${task}: Cloud Monitoring still had more pages after ${maxPages}, so ` +
      "the answer is incomplete. Narrow the filter or the window, aggregate " +
      "with .crossSeriesReducer(...), or raise .maxPages(...).",
  );
}

/** Typed Cloud Monitoring reads. */
export const CloudMonitoringTasks: CloudMonitoringTasksApi = {
  timeSeriesList: (configure) => {
    const settings = new CloudMonitoringTimeSeriesSettings();
    return readTimeSeries(
      configure ? configure(settings) : settings,
      "CloudMonitoringTasks.timeSeriesList",
    );
  },

  async metricValue(configure) {
    const settings = new CloudMonitoringMetricValueSettings();
    const configured = configure ? configure(settings) : settings;
    // Pinned after the caller's lambda: the reader judges points, and a
    // HEADERS view returns none.
    configured.view("FULL");
    return metricValueOf(
      await readTimeSeries(configured, "CloudMonitoringTasks.metricValue"),
      configured,
    );
  },
};
