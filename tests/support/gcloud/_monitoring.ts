// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Fakes for the Cloud Monitoring tests: a `fetch` that answers from a queue
 * of pages and records every URL, and builders for the API's JSON.
 *
 * @module
 */

/** The obviously fake bearer token the tests send. */
export const TOKEN = "aaaaaaaa";

/** A `fetch` answering each call with the next page, recording the URLs. */
export function pages(...bodies: Array<unknown | Response>): {
  fetch: typeof fetch;
  urls: URL[];
  headers: Headers[];
} {
  const urls: URL[] = [];
  const headers: Headers[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    urls.push(new URL(String(input)));
    headers.push(new Headers(init?.headers));
    const next = bodies.length > 1 ? bodies.shift() : bodies[0];
    return Promise.resolve(
      next instanceof Response
        ? next
        : new Response(next === undefined ? "" : JSON.stringify(next)),
    );
  };
  return { fetch, urls, headers };
}

/** One point: its end time (minutes past 12:00 on 2026-10-07) and value. */
export function point(minute: number, value: Record<string, unknown>) {
  return {
    interval: {
      startTime: new Date(Date.UTC(2026, 9, 7, 12, minute - 1)).toISOString(),
      endTime: new Date(Date.UTC(2026, 9, 7, 12, minute)).toISOString(),
    },
    value,
  };
}

/** One INT64 series of `values`, newest first, ending at minute `last`. */
export function series(
  values: number[],
  last = 10,
  revision = "api-00002",
) {
  return {
    metric: {
      type: "run.googleapis.com/request_count",
      labels: { response_code_class: "5xx" },
    },
    resource: {
      type: "cloud_run_revision",
      labels: { revision_name: revision },
    },
    metricKind: "DELTA",
    valueType: "INT64",
    points: values.map((v, i) => point(last - i, { int64Value: String(v) })),
  };
}

/** A clock pinned to 12:10:30 on 2026-10-07. */
export const NOW = () => new Date(Date.UTC(2026, 9, 7, 12, 10, 30));
