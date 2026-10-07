// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `gcloud logging` group — reading log entries and listing logs.
 *
 * ```ts
 * import { GcloudTasks } from "@zuke/gcloud";
 * await GcloudTasks.loggingRead((s) =>
 *   s.resourceType("cloud_run_revision")
 *     .resourceLabel("service_name", "api")
 *     .minSeverity("ERROR").freshness("1h").limit(20).format("json")
 *     .project("my-proj")
 * );
 * ```
 *
 * The filter is built from typed parts — each value quoted and escaped as
 * the Logging query language says — and any raw `.filter(...)` text, joined
 * with `AND`. See `filter.ts` for why a typed value cannot widen it.
 *
 * **Log entries can carry secrets.** `loggingRead` prints what it read the
 * way `gcloud logging read` does, into the build log unless `.quiet()` is
 * set. `GcloudTasks.logEntryCount` reads only each entry's `insertId`, so no
 * payload ever reaches the build.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";
import { commaJoined } from "./comma_list.ts";
import { conjunction, labelKey, loggingString } from "./filter.ts";
import { checkLimit } from "./limit.ts";
import { GcloudSettings } from "./settings.ts";
import { option } from "./validate.ts";

/** A Cloud Logging severity, lowest to highest. */
export type GcloudLogSeverity =
  | "DEFAULT"
  | "DEBUG"
  | "INFO"
  | "NOTICE"
  | "WARNING"
  | "ERROR"
  | "CRITICAL"
  | "ALERT"
  | "EMERGENCY";

/** A time a log filter compares `timestamp` with. */
export type GcloudLogTime = Date | string;

/** The time as the Logging query language compares it: RFC 3339. */
function rfc3339(time: GcloudLogTime): string {
  return typeof time === "string" ? time : time.toISOString();
}

/** A log view: its bucket, the bucket's location, and the view's id. */
type LogView = [bucket: string, location: string, view: string];

/**
 * The `--bucket`/`--location`/`--view` group both logging commands take.
 * gcloud needs all three or none ("argument --view: Must be specified"), so
 * one setter takes all three.
 */
function viewFlags(view: LogView | undefined): string[] {
  if (view === undefined) return [];
  const [bucket, location, id] = view;
  return [
    option("--bucket", bucket),
    option("--location", location),
    option("--view", id),
  ];
}

/**
 * Settings for `gcloud logging read`: which entries (the filter), from where
 * (project, folder, organization, billing account, or a log view), and how
 * many.
 */
export class GcloudLoggingReadSettings extends GcloudSettings {
  /** The most entries to read (set by {@link limit}). */
  limit_?: number;
  /** The typed filter parts, already quoted. */
  readonly #typed: string[] = [];
  /** The raw filter parts, as written. */
  readonly #raw: string[] = [];
  #freshness?: string;
  #order?: "asc" | "desc";
  #parent?: [string, string];
  #view?: LogView;
  #resourceNames: string[] = [];

  /** The task name used in this command's error messages. */
  protected taskName(): string {
    return "loggingRead";
  }

  /**
   * Raw filter text in the Logging query language, joined with every other
   * part by `AND`; repeatable. It is the caller's own text and is not
   * escaped — never build it from an untrusted value; use the typed setters
   * for those.
   */
  filter(expression: string): this {
    this.#raw.push(expression);
    return this;
  }

  /** Only entries from this monitored-resource type: `resource.type="…"`. */
  resourceType(type: string): this {
    this.#typed.push(
      `resource.type=${loggingString(this.#task, "resource type", type)}`,
    );
    return this;
  }

  /** Only entries whose resource label `key` is `value`; repeatable. */
  resourceLabel(key: string, value: string): this {
    this.#typed.push(
      `resource.labels.${labelKey(this.#task, key)}=${
        loggingString(this.#task, "resource label value", value)
      }`,
    );
    return this;
  }

  /** Only entries whose own label `key` is `value`; repeatable. */
  label(key: string, value: string): this {
    this.#typed.push(
      `labels.${labelKey(this.#task, key)}=${
        loggingString(this.#task, "label value", value)
      }`,
    );
    return this;
  }

  /** Only entries at `severity` or above: `severity>=ERROR`. */
  minSeverity(severity: GcloudLogSeverity): this {
    this.#typed.push(`severity>=${severity}`);
    return this;
  }

  /**
   * Only entries at or after `time`: `timestamp>="…"`. With a timestamp in
   * the filter, gcloud ignores `--freshness`.
   */
  since(time: GcloudLogTime): this {
    this.#typed.push(
      `timestamp>=${loggingString(this.#task, "time", rfc3339(time))}`,
    );
    return this;
  }

  /** Only entries before `time`: `timestamp<"…"`. */
  until(time: GcloudLogTime): this {
    this.#typed.push(
      `timestamp<${loggingString(this.#task, "time", rfc3339(time))}`,
    );
    return this;
  }

  /**
   * Only entries newer than this (`--freshness`; gcloud's default is one
   * day) — `"1h"`, `"90s"`, or ms. gcloud applies it only to a descending
   * read with no timestamp in the filter.
   */
  freshness(duration: string | number): this {
    const ms = parseDuration(duration);
    if (ms < 1000) {
      throw new Error(
        `GcloudTasks.${this.#task}: .freshness(${
          JSON.stringify(duration)
        }) is under a second, and gcloud counts it in whole seconds.`,
      );
    }
    this.#freshness = `${Math.ceil(ms / 1000)}s`;
    return this;
  }

  /** Newest first (`desc`, gcloud's default) or oldest first (`--order`). */
  order(order: "asc" | "desc"): this {
    this.#order = order;
    return this;
  }

  /** Read at most this many entries (`--limit`; gcloud's default is unlimited). */
  limit(count: number): this {
    this.limit_ = count;
    return this;
  }

  /**
   * Read from an organization's logs (`--organization`). gcloud takes one of
   * `--organization`, `--folder`, `--billing-account` and `--project`.
   */
  organization(id: string): this {
    this.#parent = ["--organization", id];
    return this;
  }

  /** Read from a folder's logs (`--folder`). */
  folder(id: string): this {
    this.#parent = ["--folder", id];
    return this;
  }

  /** Read from a billing account's logs (`--billing-account`). */
  billingAccount(id: string): this {
    this.#parent = ["--billing-account", id];
    return this;
  }

  /** Read through a log view (`--bucket`, `--location`, `--view`). */
  logView(bucket: string, location: string, view: string): this {
    this.#view = [bucket, location, view];
    return this;
  }

  /**
   * Read from these resources instead (`--resource-names`): a project,
   * folder or organization name, or a full log-view path. gcloud takes these
   * or a log view, not both.
   */
  resourceNames(...names: string[]): this {
    this.#resourceNames.push(...names);
    return this;
  }

  /** The task name, for the messages raised while a setter runs. */
  get #task(): string {
    return this.taskName();
  }

  /** Emit `logging read` with its filter and flags. */
  protected override leadingTokens(): string[] {
    const task = this.#task;
    checkLimit(this.limit_, task);
    const view = viewFlags(this.#view);
    if (view.length > 0 && this.#resourceNames.length > 0) {
      throw new Error(
        `GcloudTasks.${task}: .logView(...) and .resourceNames(...) each say ` +
          "where to read from, and gcloud accepts one. Keep one.",
      );
    }
    const argv = ["logging", "read"];
    const filter = conjunction(this.#typed, this.#raw);
    if (filter !== "") argv.push(filter);
    if (this.#freshness !== undefined) {
      argv.push(option("--freshness", this.#freshness));
    }
    if (this.#order !== undefined) argv.push(option("--order", this.#order));
    if (this.#parent !== undefined) {
      argv.push(option(this.#parent[0], this.#parent[1]));
    }
    argv.push(...view);
    if (this.#resourceNames.length > 0) {
      argv.push(
        option(
          "--resource-names",
          commaJoined(this.#resourceNames, task, "--resource-names"),
        ),
      );
    }
    if (this.limit_ !== undefined) argv.push(option("--limit", this.limit_));
    return argv;
  }
}

/** Settings for `gcloud logging logs list`: the logs that hold entries. */
export class GcloudLoggingLogsListSettings extends GcloudSettings {
  #view?: LogView;
  #filter?: string;
  #limit?: number;
  #sortBy: string[] = [];

  /** List the logs of a log view (`--bucket`, `--location`, `--view`). */
  logView(bucket: string, location: string, view: string): this {
    this.#view = [bucket, location, view];
    return this;
  }

  /** Keep only matching logs (`--filter`), gcloud's own list filter. */
  filter(expression: string): this {
    this.#filter = expression;
    return this;
  }

  /** List at most this many logs (`--limit`). */
  limit(count: number): this {
    this.#limit = count;
    return this;
  }

  /** Sort by these fields (`--sort-by`); prefix one with `~` to descend. */
  sortBy(...fields: string[]): this {
    this.#sortBy.push(...fields);
    return this;
  }

  /** Emit `logging logs list` with its flags. */
  protected override leadingTokens(): string[] {
    checkLimit(this.#limit, "loggingLogsList");
    const argv = [
      "logging",
      "logs",
      "list",
      ...viewFlags(this.#view),
    ];
    if (this.#filter !== undefined) {
      argv.push(option("--filter", this.#filter));
    }
    if (this.#limit !== undefined) argv.push(option("--limit", this.#limit));
    if (this.#sortBy.length > 0) {
      argv.push(
        option(
          "--sort-by",
          commaJoined(this.#sortBy, "loggingLogsList", "--sort-by"),
        ),
      );
    }
    return argv;
  }
}
