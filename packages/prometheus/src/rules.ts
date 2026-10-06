// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Loaded rules (`/api/v1/rules`) and active alerts (`/api/v1/alerts`).
 *
 * The API reference notes both endpoints carry weaker stability guarantees
 * than the rest of v1, so only the fields every documented example carries
 * are required; the rest are optional.
 *
 * @module
 */

import { PrometheusConnectionSettings } from "./connection.ts";
import { definedParams, formatCount, nonEmpty } from "./params.ts";
import {
  own,
  readArray,
  readNumber,
  readOptionalLabels,
  readOptionalNumber,
  readOptionalString,
  readRecord,
  readString,
} from "./shape.ts";
import type { PrometheusCall } from "./transport.ts";
import type { PrometheusLabels } from "./types.ts";
import { parseSampleValue } from "./values.ts";

/** The rule kinds `/api/v1/rules` filters on: the API's `type` parameter. */
export type PrometheusRuleType = "alert" | "record";

/** Settings for the loaded rules (`/api/v1/rules`). */
export class PrometheusRulesSettings extends PrometheusConnectionSettings {
  /** The `type` filter (set by {@link type}). */
  type_?: PrometheusRuleType;
  /** Rule names to keep (set by {@link ruleName}), as `rule_name[]`. */
  readonly ruleName_: string[] = [];
  /** Rule groups to keep (set by {@link ruleGroup}), as `rule_group[]`. */
  readonly ruleGroup_: string[] = [];
  /** Rule files to keep (set by {@link file}), as `file[]`. */
  readonly file_: string[] = [];
  /** Label selectors rules must match (set by {@link match}), as `match[]`. */
  readonly match_: string[] = [];
  /** Whether to leave out active alerts (set by {@link excludeAlerts}). */
  excludeAlerts_ = false;
  /** The group page size (set by {@link groupLimit}). */
  groupLimit_?: string;
  /** The pagination token (set by {@link groupNextToken}). */
  groupNextToken_?: string;

  /** Only alerting (`"alert"`) or only recording (`"record"`) rules (`type`). */
  type(type: PrometheusRuleType): this {
    this.type_ = type;
    return this;
  }

  /** Only rules with these names (`rule_name[]`). */
  ruleName(...names: string[]): this {
    for (const name of names) {
      this.ruleName_.push(nonEmpty(name, "ruleName(...)"));
    }
    return this;
  }

  /** Only rules in these groups (`rule_group[]`). */
  ruleGroup(...groups: string[]): this {
    for (const group of groups) {
      this.ruleGroup_.push(nonEmpty(group, "ruleGroup(...)"));
    }
    return this;
  }

  /** Only rules from these files (`file[]`). */
  file(...paths: string[]): this {
    for (const path of paths) this.file_.push(nonEmpty(path, "file(...)"));
    return this;
  }

  /** Only rules whose configured labels match these selectors (`match[]`). */
  match(...selectors: string[]): this {
    for (const selector of selectors) {
      this.match_.push(nonEmpty(selector, "match(...)"));
    }
    return this;
  }

  /** Leave out each rule's active alerts (`exclude_alerts=true`). */
  excludeAlerts(on = true): this {
    this.excludeAlerts_ = on;
    return this;
  }

  /** At most this many rule groups per page (`group_limit`). */
  groupLimit(groups: number): this {
    this.groupLimit_ = formatCount(groups, "groupLimit(...)");
    return this;
  }

  /** Continue from a previous page's `groupNextToken` (`group_next_token`). */
  groupNextToken(token: string): this {
    this.groupNextToken_ = nonEmpty(token, "groupNextToken(...)");
    return this;
  }
}

/** An alert, active or pending, as the rules and alerts endpoints report it. */
export interface PrometheusAlert {
  /** The alert's labels, `alertname` among them. */
  readonly labels: PrometheusLabels;
  /** The alert's annotations. */
  readonly annotations: PrometheusLabels;
  /** `firing` or `pending` (or `inactive` where a server reports it). */
  readonly state: string;
  /** When the alert became active (RFC 3339). */
  readonly activeAt?: string;
  /** The expression's value when the alert last evaluated. */
  readonly value: number;
  /** Until when it keeps firing after resolving, if `keep_firing_for` is set. */
  readonly keepFiringSince?: string;
}

/** Fields every rule carries. */
export interface PrometheusRuleFields {
  /** The rule's name: the alert name or the recorded series. */
  readonly name: string;
  /** The PromQL expression. */
  readonly query: string;
  /** The rule's configured labels. */
  readonly labels: PrometheusLabels;
  /** `ok`, `err` or `unknown`. */
  readonly health: string;
  /** The last evaluation's error, when it failed. */
  readonly lastError?: string;
  /** How long the last evaluation took, in seconds. */
  readonly evaluationTime?: number;
  /** When the rule last evaluated (RFC 3339). */
  readonly lastEvaluation?: string;
}

/** An alerting rule. */
export interface PrometheusAlertingRule extends PrometheusRuleFields {
  /** The rule kind. */
  readonly type: "alerting";
  /** The `for` duration, in seconds. */
  readonly duration: number;
  /** The rule's annotations. */
  readonly annotations: PrometheusLabels;
  /** The rule's active alerts; absent when `excludeAlerts` was set. */
  readonly alerts?: readonly PrometheusAlert[];
  /** The rule's state: `firing`, `pending` or `inactive`. */
  readonly state?: string;
}

/** A recording rule. */
export interface PrometheusRecordingRule extends PrometheusRuleFields {
  /** The rule kind. */
  readonly type: "recording";
}

/** A rule, discriminated on `type`. */
export type PrometheusRule = PrometheusAlertingRule | PrometheusRecordingRule;

/** A rule group. */
export interface PrometheusRuleGroup {
  /** The group's name. */
  readonly name: string;
  /** The file it was loaded from. */
  readonly file: string;
  /** The evaluation interval, in seconds. */
  readonly interval: number;
  /** The group's rules. */
  readonly rules: readonly PrometheusRule[];
  /** The group's alert/series limit, when the server reports it. */
  readonly limit?: number;
  /** How long the group's last evaluation took, in seconds. */
  readonly evaluationTime?: number;
  /** When the group last evaluated (RFC 3339). */
  readonly lastEvaluation?: string;
}

/** The loaded rules. */
export interface PrometheusRules {
  /** The rule groups. */
  readonly groups: readonly PrometheusRuleGroup[];
  /** The token for the next page, when `groupLimit` cut the list short. */
  readonly groupNextToken?: string;
}

/** The active alerts. */
export interface PrometheusAlerts {
  /** Every active alert. */
  readonly alerts: readonly PrometheusAlert[];
}

/** The `/api/v1/rules` call the settings describe. */
export function rulesCall(settings: PrometheusRulesSettings): PrometheusCall {
  const repeated = (name: string, values: string[]): Array<[string, string]> =>
    values.map((value) => [name, value]);
  return {
    method: "GET",
    path: "/api/v1/rules",
    params: [
      ...definedParams([["type", settings.type_]]),
      ...repeated("rule_name[]", settings.ruleName_),
      ...repeated("rule_group[]", settings.ruleGroup_),
      ...repeated("file[]", settings.file_),
      ...repeated("match[]", settings.match_),
      ...definedParams([
        ["exclude_alerts", settings.excludeAlerts_ ? "true" : undefined],
        ["group_limit", settings.groupLimit_],
        ["group_next_token", settings.groupNextToken_],
      ]),
    ],
  };
}

/** One alert. */
function parseAlert(value: unknown): PrometheusAlert {
  const what = "an alert";
  const alert = readRecord(value, what);
  return {
    labels: readOptionalLabels(alert, "labels", what),
    annotations: readOptionalLabels(alert, "annotations", what),
    state: readString(alert, "state", what),
    activeAt: readOptionalString(alert, "activeAt", what),
    value: parseSampleValue(readString(alert, "value", what), `${what} value`),
    keepFiringSince: readOptionalString(alert, "keepFiringSince", what),
  };
}

/** One rule, by its `type`. */
function parseRule(value: unknown): PrometheusRule {
  const what = "a rule";
  const rule = readRecord(value, what);
  const fields: PrometheusRuleFields = {
    name: readString(rule, "name", what),
    query: readString(rule, "query", what),
    labels: readOptionalLabels(rule, "labels", what),
    health: readString(rule, "health", what),
    lastError: readOptionalString(rule, "lastError", what),
    evaluationTime: readOptionalNumber(rule, "evaluationTime", what),
    lastEvaluation: readOptionalString(rule, "lastEvaluation", what),
  };
  const type = readString(rule, "type", what);
  if (type === "recording") return { ...fields, type };
  if (type !== "alerting") {
    throw new Error(`a rule has an unknown type ${JSON.stringify(type)}`);
  }
  const alerts = own(rule, "alerts");
  return {
    ...fields,
    type,
    duration: readNumber(rule, "duration", what),
    annotations: readOptionalLabels(rule, "annotations", what),
    alerts: alerts === undefined
      ? undefined
      : readArray(alerts, "a rule's alerts").map(parseAlert),
    state: readOptionalString(rule, "state", what),
  };
}

/** One rule group. */
function parseGroup(value: unknown): PrometheusRuleGroup {
  const what = "a rule group";
  const group = readRecord(value, what);
  return {
    name: readString(group, "name", what),
    file: readString(group, "file", what),
    interval: readNumber(group, "interval", what),
    rules: readArray(own(group, "rules"), "a rule group's rules").map(
      parseRule,
    ),
    limit: readOptionalNumber(group, "limit", what),
    evaluationTime: readOptionalNumber(group, "evaluationTime", what),
    lastEvaluation: readOptionalString(group, "lastEvaluation", what),
  };
}

/** The rules endpoint's data. */
export function parseRulesData(data: unknown): PrometheusRules {
  const object = readRecord(data, "the rules");
  return {
    groups: readArray(own(object, "groups"), "the rule groups").map(parseGroup),
    groupNextToken: readOptionalString(object, "groupNextToken", "the rules"),
  };
}

/** The alerts endpoint's data. */
export function parseAlertsData(data: unknown): PrometheusAlerts {
  const object = readRecord(data, "the alerts");
  return {
    alerts: readArray(own(object, "alerts"), "the alerts").map(parseAlert),
  };
}
