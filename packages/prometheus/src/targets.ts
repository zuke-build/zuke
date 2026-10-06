// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Target discovery state (`/api/v1/targets`) and server build information
 * (`/api/v1/status/buildinfo`).
 *
 * The fields the API reference documents for every target are required; the
 * ones it marks newer or optional (`globalUrl`, the scrape interval and
 * timeout, …) are optional here, so an older server or a compatible one
 * (Thanos, Mimir) still parses.
 *
 * @module
 */

import { PrometheusConnectionSettings } from "./connection.ts";
import {
  own,
  readArray,
  readLabels,
  readOptionalLabels,
  readOptionalNumber,
  readOptionalString,
  readRecord,
  readString,
} from "./shape.ts";
import type { PrometheusCall } from "./transport.ts";
import type { PrometheusLabels } from "./types.ts";

/** Which targets `/api/v1/targets` returns: the API's `state` parameter. */
export type PrometheusTargetState = "active" | "dropped" | "any";

/** Settings for the target overview (`/api/v1/targets`). */
export class PrometheusTargetsSettings extends PrometheusConnectionSettings {
  /** The `state` filter (set by {@link state}). */
  state_?: PrometheusTargetState;

  /** Only active or only dropped targets (`state`); both by default. */
  state(state: PrometheusTargetState): this {
    this.state_ = state;
    return this;
  }
}

/** A target Prometheus is scraping. */
export interface PrometheusActiveTarget {
  /** The labels service discovery found, before relabelling. */
  readonly discoveredLabels: PrometheusLabels;
  /** The labels after relabelling. */
  readonly labels: PrometheusLabels;
  /** The scrape pool (the job) the target belongs to. */
  readonly scrapePool: string;
  /** The URL scraped. */
  readonly scrapeUrl: string;
  /** The URL as seen from outside, when the server reports it. */
  readonly globalUrl?: string;
  /** The last scrape's error, `""` when it succeeded. */
  readonly lastError?: string;
  /** When the last scrape happened (RFC 3339). */
  readonly lastScrape?: string;
  /** How long the last scrape took, in seconds. */
  readonly lastScrapeDuration?: number;
  /** `up`, `down` or `unknown`. */
  readonly health: string;
  /** The scrape interval, such as `"1m"`. */
  readonly scrapeInterval?: string;
  /** The scrape timeout, such as `"10s"`. */
  readonly scrapeTimeout?: string;
}

/** A target relabelling dropped. */
export interface PrometheusDroppedTarget {
  /** The labels service discovery found. */
  readonly discoveredLabels: PrometheusLabels;
  /** The scrape pool, when the server reports it. */
  readonly scrapePool?: string;
}

/** The target overview: active and dropped targets. */
export interface PrometheusTargets {
  /** The targets being scraped. */
  readonly activeTargets: readonly PrometheusActiveTarget[];
  /** The targets relabelling dropped (subject to `keep_dropped_targets`). */
  readonly droppedTargets: readonly PrometheusDroppedTarget[];
}

/**
 * The server's build information. `version` is always present; the API notes
 * the other properties may change between versions, so they are optional.
 */
export interface PrometheusBuildInfo {
  /** The Prometheus version, such as `"3.5.0"`. */
  readonly version: string;
  /** The VCS revision it was built from. */
  readonly revision?: string;
  /** The branch it was built from. */
  readonly branch?: string;
  /** Who built it. */
  readonly buildUser?: string;
  /** When it was built. */
  readonly buildDate?: string;
  /** The Go version it was built with. */
  readonly goVersion?: string;
}

/** The `/api/v1/targets` call the settings describe. */
export function targetsCall(
  settings: PrometheusTargetsSettings,
): PrometheusCall {
  return {
    method: "GET",
    path: "/api/v1/targets",
    params: settings.state_ === undefined ? [] : [["state", settings.state_]],
  };
}

/** `object[key]` read as a list, an absent key reading as none. */
function listOf(
  object: Record<string, unknown>,
  key: string,
): unknown[] {
  const value = own(object, key);
  return value === undefined ? [] : readArray(value, key);
}

/** One active target. */
function parseActiveTarget(value: unknown): PrometheusActiveTarget {
  const what = "an active target";
  const target = readRecord(value, what);
  return {
    discoveredLabels: readOptionalLabels(target, "discoveredLabels", what),
    labels: readLabels(own(target, "labels"), `${what}'s labels`),
    scrapePool: readString(target, "scrapePool", what),
    scrapeUrl: readString(target, "scrapeUrl", what),
    globalUrl: readOptionalString(target, "globalUrl", what),
    lastError: readOptionalString(target, "lastError", what),
    lastScrape: readOptionalString(target, "lastScrape", what),
    lastScrapeDuration: readOptionalNumber(target, "lastScrapeDuration", what),
    health: readString(target, "health", what),
    scrapeInterval: readOptionalString(target, "scrapeInterval", what),
    scrapeTimeout: readOptionalString(target, "scrapeTimeout", what),
  };
}

/** One dropped target. */
function parseDroppedTarget(value: unknown): PrometheusDroppedTarget {
  const what = "a dropped target";
  const target = readRecord(value, what);
  return {
    discoveredLabels: readOptionalLabels(target, "discoveredLabels", what),
    scrapePool: readOptionalString(target, "scrapePool", what),
  };
}

/** The targets endpoint's data. */
export function parseTargetsData(data: unknown): PrometheusTargets {
  const object = readRecord(data, "the targets");
  return {
    activeTargets: listOf(object, "activeTargets").map(parseActiveTarget),
    droppedTargets: listOf(object, "droppedTargets").map(parseDroppedTarget),
  };
}

/** The build-info endpoint's data. */
export function parseBuildInfoData(data: unknown): PrometheusBuildInfo {
  const what = "the build information";
  const object = readRecord(data, what);
  return {
    version: readString(object, "version", what),
    revision: readOptionalString(object, "revision", what),
    branch: readOptionalString(object, "branch", what),
    buildUser: readOptionalString(object, "buildUser", what),
    buildDate: readOptionalString(object, "buildDate", what),
    goVersion: readOptionalString(object, "goVersion", what),
  };
}
