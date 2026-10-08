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
import { checkCount, checkLimit } from "./limit.ts";
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

/** Every severity, lowest to highest, for the runtime check. */
const SEVERITIES: readonly GcloudLogSeverity[] = [
  "DEFAULT",
  "DEBUG",
  "INFO",
  "NOTICE",
  "WARNING",
  "ERROR",
  "CRITICAL",
  "ALERT",
  "EMERGENCY",
];

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
  #order?: "asc" | "desc";
  #parent?: [string, string];
  #view?: LogView;
  #resourceNames: string[] = [];

  /** How long back `.freshness(...)` reaches, in ms (set by {@link freshness}). */
  freshness_?: number;
  /** The earliest time `.since(...)` admits (set by {@link since}). */
  since_?: GcloudLogTime;
  /** The clock `.freshness(...)` is measured from (set by {@link now}). */
  now_: () => Date = () => new Date();
  /** The `timestamp>=` bound `.freshness(...)` resolved to. */
  #freshnessSince?: string;

  /** Who this command's error messages name. */
  protected owner(): string {
    return "GcloudTasks.loggingRead";
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
      `resource.type=${loggingString(this.#owner, "resource type", type)}`,
    );
    return this;
  }

  /** Only entries whose resource label `key` is `value`; repeatable. */
  resourceLabel(key: string, value: string): this {
    this.#typed.push(
      `resource.labels.${labelKey(this.#owner, key)}=${
        loggingString(this.#owner, "resource label value", value)
      }`,
    );
    return this;
  }

  /** Only entries whose own label `key` is `value`; repeatable. */
  label(key: string, value: string): this {
    this.#typed.push(
      `labels.${labelKey(this.#owner, key)}=${
        loggingString(this.#owner, "label value", value)
      }`,
    );
    return this;
  }

  /** Only entries at `severity` or above: `severity>=ERROR`. */
  minSeverity(severity: GcloudLogSeverity): this {
    // The type admits only the nine names; a JavaScript caller's string is
    // checked too, since it goes into the filter unquoted.
    if (!SEVERITIES.some((known) => known === severity)) {
      throw new Error(
        `${this.#owner}: ${
          JSON.stringify(severity)
        } is not a Cloud Logging severity — use one of ${
          SEVERITIES.join(", ")
        }.`,
      );
    }
    this.#typed.push(`severity>=${severity}`);
    return this;
  }

  /** Only entries at or after `time`: `timestamp>="…"`. */
  since(time: GcloudLogTime): this {
    this.since_ = time;
    this.#typed.push(
      `timestamp>=${loggingString(this.#owner, "time", rfc3339(time))}`,
    );
    return this;
  }

  /** Only entries before `time`: `timestamp<"…"`. */
  until(time: GcloudLogTime): this {
    this.#typed.push(
      `timestamp<${loggingString(this.#owner, "time", rfc3339(time))}`,
    );
    return this;
  }

  /**
   * Only entries newer than this — `"1h"`, `"90s"`, or ms — sent as an
   * explicit `timestamp>="<now − duration>"` in the filter, measured from
   * {@link now}. gcloud's own `--freshness` is not used: gcloud silently
   * drops it whenever the filter's text contains the word `timestamp`
   * anywhere, or the order is `asc`, and the read then spans the whole
   * retention period.
   */
  freshness(duration: string | number): this {
    const ms = parseDuration(duration);
    if (ms <= 0) {
      throw new Error(
        `${this.#owner}: .freshness(${
          JSON.stringify(duration)
        }) must be longer than zero.`,
      );
    }
    this.freshness_ = ms;
    this.#resolveFreshness();
    return this;
  }

  /**
   * The clock {@link freshness} is measured from — the seam a test pins it
   * with. Either may be set first.
   */
  now(clock: () => Date): this {
    this.now_ = clock;
    this.#resolveFreshness();
    return this;
  }

  /**
   * Resolve the freshness bound now, in a setter — so the clock is read at
   * task time, inside the settings lambda, and argv stays a pure function of
   * the settings.
   */
  #resolveFreshness(): void {
    if (this.freshness_ === undefined) return;
    const since = new Date(this.now_().getTime() - this.freshness_);
    this.#freshnessSince = `timestamp>=${
      loggingString(this.#owner, "time", rfc3339(since))
    }`;
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

  /** Who the messages raised while a setter runs name. */
  get #owner(): string {
    return this.owner();
  }

  /** Emit `logging read` with its filter and flags. */
  protected override leadingTokens(): string[] {
    const owner = this.#owner;
    checkCount(this.limit_, owner, "limit");
    const view = viewFlags(this.#view);
    if (view.length > 0 && this.#resourceNames.length > 0) {
      throw new Error(
        `${owner}: .logView(...) and .resourceNames(...) each say where to ` +
          "read from, and gcloud accepts one. Keep one.",
      );
    }
    const argv = ["logging", "read"];
    const typed = this.#freshnessSince === undefined
      ? this.#typed
      : [...this.#typed, this.#freshnessSince];
    const filter = conjunction(typed, this.#raw);
    if (filter !== "") argv.push(filter);
    if (this.#order !== undefined) argv.push(option("--order", this.#order));
    if (this.#parent !== undefined) {
      argv.push(option(this.#parent[0], this.#parent[1]));
    }
    argv.push(...view);
    if (this.#resourceNames.length > 0) {
      argv.push(
        option(
          "--resource-names",
          commaJoined(this.#resourceNames, owner, "--resource-names"),
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
          commaJoined(this.#sortBy, "GcloudTasks.loggingLogsList", "--sort-by"),
        ),
      );
    }
    return argv;
  }
}
