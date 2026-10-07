// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `gcloud monitoring` group — alerting policies, dashboards and uptime
 * checks, all on the GA track.
 *
 * ```ts
 * import { GcloudTasks } from "@zuke/gcloud";
 * await GcloudTasks.monitoringPoliciesList((s) =>
 *   s.filter("displayName:api").sortBy("display_name").format("json")
 * );
 * ```
 *
 * gcloud has no command that reads a metric's time series — not on the GA,
 * beta or alpha track — so metric data is read over the Cloud Monitoring REST
 * API by `CloudMonitoringTasks` instead.
 *
 * @module
 */

import { commaJoined } from "./comma_list.ts";
import { checkLimit } from "./limit.ts";
import { GcloudSettings } from "./settings.ts";
import { operand, option } from "./validate.ts";

/**
 * The list flags every `gcloud monitoring … list` command takes: `--filter`,
 * `--limit`, `--page-size`, `--sort-by` and `--uri`. Each listing extends it
 * and names its own command path.
 */
export abstract class GcloudMonitoringListSettings extends GcloudSettings {
  #filter?: string;
  #limit?: number;
  #pageSize?: number;
  #sortBy: string[] = [];
  #uri = false;

  /** The command path, e.g. `["monitoring", "policies", "list"]`. */
  protected abstract listCommand(): string[];

  /** The task name used in this listing's error messages. */
  protected abstract taskName(): string;

  /** Keep only matching items (`--filter`), gcloud's own list filter. */
  filter(expression: string): this {
    this.#filter = expression;
    return this;
  }

  /** List at most this many items (`--limit`). */
  limit(count: number): this {
    this.#limit = count;
    return this;
  }

  /** How many items to request per page (`--page-size`). */
  pageSize(count: number): this {
    this.#pageSize = count;
    return this;
  }

  /** Sort by these fields (`--sort-by`); prefix one with `~` to descend. */
  sortBy(...fields: string[]): this {
    this.#sortBy.push(...fields);
    return this;
  }

  /** Print each item's resource URI instead (`--uri`). */
  uri(): this {
    this.#uri = true;
    return this;
  }

  /** Emit the listing's command path with its flags. */
  protected override leadingTokens(): string[] {
    const task = this.taskName();
    checkLimit(this.#limit, task);
    const pageSize = this.#pageSize;
    checkLimit(pageSize, task, "pageSize");
    const argv = this.listCommand();
    if (this.#filter !== undefined) {
      argv.push(option("--filter", this.#filter));
    }
    if (this.#limit !== undefined) argv.push(option("--limit", this.#limit));
    if (pageSize !== undefined) argv.push(option("--page-size", pageSize));
    if (this.#sortBy.length > 0) {
      argv.push(
        option("--sort-by", commaJoined(this.#sortBy, task, "--sort-by")),
      );
    }
    if (this.#uri) argv.push("--uri");
    return argv;
  }
}

/** Settings for `gcloud monitoring policies list`: the alerting policies. */
export class GcloudMonitoringPoliciesListSettings
  extends GcloudMonitoringListSettings {
  /** `monitoring policies list`. */
  protected override listCommand(): string[] {
    return ["monitoring", "policies", "list"];
  }

  /** The task name used in this listing's error messages. */
  protected override taskName(): string {
    return "monitoringPoliciesList";
  }
}

/** Settings for `gcloud monitoring dashboards list`. */
export class GcloudMonitoringDashboardsListSettings
  extends GcloudMonitoringListSettings {
  /** `monitoring dashboards list`. */
  protected override listCommand(): string[] {
    return ["monitoring", "dashboards", "list"];
  }

  /** The task name used in this listing's error messages. */
  protected override taskName(): string {
    return "monitoringDashboardsList";
  }
}

/**
 * Settings for `gcloud monitoring uptime list-configs`: the uptime checks and
 * synthetic monitors.
 */
export class GcloudMonitoringUptimeListConfigsSettings
  extends GcloudMonitoringListSettings {
  /** `monitoring uptime list-configs`. */
  protected override listCommand(): string[] {
    return ["monitoring", "uptime", "list-configs"];
  }

  /** The task name used in this listing's error messages. */
  protected override taskName(): string {
    return "monitoringUptimeListConfigs";
  }
}

/** Settings for `gcloud monitoring policies describe`. */
export class GcloudMonitoringPoliciesDescribeSettings extends GcloudSettings {
  #policy?: string;

  /**
   * The policy to describe (positional): its id, or its full name
   * `projects/<project>/alertPolicies/<id>`.
   */
  policy(idOrName: string): this {
    this.#policy = idOrName;
    return this;
  }

  /** Emit `monitoring policies describe` with its operand. */
  protected override leadingTokens(): string[] {
    if (this.#policy === undefined) {
      throw new Error(
        "GcloudTasks.monitoringPoliciesDescribe: no policy named — add " +
          ".policy(id).",
      );
    }
    return [
      "monitoring",
      "policies",
      "describe",
      operand("monitoringPoliciesDescribe", "policy", this.#policy),
    ];
  }
}
