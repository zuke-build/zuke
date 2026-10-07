// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az monitor log-analytics query` — a KQL query against a Log Analytics
 * workspace, and the rows it returns.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * const rows = await AzTasks.logAnalyticsQuery((q) =>
 *   q.workspace(workspaceId).timespan("30m")
 *     .analyticsQuery("AppRequests | where Success == false | count")
 * );
 * ```
 *
 * The command comes from the CLI's `log-analytics` extension — a preview
 * extension — which the wrapper does not install on the fly (see
 * `AzSettings`): add it once with `az extension add --name log-analytics`.
 * Without it the CLI only says the command `is misspelled or not recognized
 * by the system` and exits 2; the tasks here turn that into an error that
 * names the extension.
 *
 * The extension flattens the answer's tables into one list of rows, each
 * with a `TableName` and every column **as a string** — Python's rendering
 * of it, so a number reads `"42"` or `"0.5"`, a boolean `"True"`, and an
 * empty cell `"None"`. The API answers in one response, with no paging; a
 * query that exceeds the service's limits is cut short by the service.
 *
 * @module
 */

import { parseDuration } from "@zuke/core";
import { CommandError } from "@zuke/core/shell";
import { AzOutputError } from "./errors.ts";
import { AzSettings } from "./settings.ts";
import { isRecord } from "./shape.ts";
import { isoDuration } from "./time.ts";
import { operands, option, required } from "./validate.ts";

/** What the CLI prints for a command whose extension is not installed. */
const NOT_RECOGNIZED = "is misspelled or not recognized by the system";

/**
 * Run `read`, turning the CLI's "not recognized" failure — exit 2, which is
 * all it reports when the `log-analytics` extension is missing — into an
 * error that names the extension and how to install it. Any other failure
 * is passed on as it is.
 */
export async function needingExtension<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof CommandError && error.code === 2 &&
      error.stderr.includes(NOT_RECOGNIZED)
    ) {
      throw new Error(
        "monitor log-analytics query comes from the CLI's log-analytics " +
          "extension (a preview extension), and the log-analytics extension " +
          "is not installed: az extension add --name log-analytics",
        { cause: error },
      );
    }
    throw error;
  }
}

/** One row of a Log Analytics answer: `TableName`, and each column by name. */
export type AzLogAnalyticsRow = Record<string, string>;

/** Settings for `az monitor log-analytics query`. */
export class AzMonitorLogAnalyticsQuerySettings extends AzSettings {
  #workspace?: string;
  #analyticsQuery?: string;
  #timespan?: string;
  readonly #workspaces: string[] = [];

  /** The workspace's id — its customer id, a GUID (`--workspace`). */
  workspace(id: string): this {
    this.#workspace = id;
    return this;
  }

  /** The KQL query (`--analytics-query`). */
  analyticsQuery(query: string): this {
    this.#analyticsQuery = query;
    return this;
  }

  /**
   * The range to query (`--timespan`): a duration back from now, as `"30m"`
   * or milliseconds (sent as ISO 8601), or an ISO 8601 interval string such
   * as `"2026-10-07T10:00:00Z/2026-10-07T11:00:00Z"`, sent as written. All
   * the data by default.
   */
  timespan(range: string | number): this {
    this.#timespan = typeof range === "string" && /^P|\//.test(range)
      ? range
      : isoDuration(parseDuration(range));
    return this;
  }

  /** Further workspaces to union into the query (`--workspaces`); repeatable. */
  workspaces(...ids: string[]): this {
    this.#workspaces.push(...ids);
    return this;
  }

  /** Emit `monitor log-analytics query` with its options. */
  protected override leadingTokens(): string[] {
    const task = "monitorLogAnalyticsQuery";
    const workspace = required(
      this.#workspace,
      task,
      "no workspace — add .workspace(workspaceId).",
    );
    const query = required(
      this.#analyticsQuery,
      task,
      "no query — add .analyticsQuery(kql).",
    );
    const argv = [
      "monitor",
      "log-analytics",
      "query",
      option("--workspace", workspace),
      option("--analytics-query", query),
    ];
    if (this.#timespan !== undefined) {
      argv.push(option("--timespan", this.#timespan));
    }
    if (this.#workspaces.length > 0) {
      argv.push(
        "--workspaces",
        ...operands(task, "--workspaces", this.#workspaces),
      );
    }
    return argv;
  }
}

/** The rows of a parsed `log-analytics query` answer, checked to be strings. */
export function rowsOf(document: unknown, task: string): AzLogAnalyticsRow[] {
  if (!Array.isArray(document)) {
    throw new AzOutputError(task, "the query's answer is not a list of rows.");
  }
  return document.map((row) => {
    if (!isRecord(row)) {
      throw new AzOutputError(task, "a row of the answer is not an object.");
    }
    const cells: AzLogAnalyticsRow = {};
    for (const [column, value] of Object.entries(row)) {
      if (typeof value !== "string") {
        throw new AzOutputError(
          task,
          `column "${column}" is not a string — the extension renders every ` +
            "cell as one.",
        );
      }
      cells[column] = value;
    }
    return cells;
  });
}
