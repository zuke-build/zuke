// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the read-only `deno deploy` commands: logs, deployments,
 * applications, organizations and the token's identity.
 *
 * @module
 */

import { DenoDeployCommandSettings, option } from "./deploy_settings.ts";

/** `count` if it is a whole number from 1 up, else a friendly error. */
function limit(task: string, count: number): number {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error(
      `DenoDeployTasks.${task}: .limit() takes a whole number from 1 up, ` +
        `not ${count}.`,
    );
  }
  return count;
}

/** `timestamp` as the ISO 8601 text the CLI parses. */
function isoTime(timestamp: string | Date): string {
  return timestamp instanceof Date ? timestamp.toISOString() : timestamp;
}

/** Settings for `deno deploy logs`. */
export class DenoDeployLogsSettings extends DenoDeployCommandSettings {
  #flags: string[] = [];

  /** Logs from this timestamp on, e.g. `2026-01-01T00:00:00Z` (`--start`). */
  start(timestamp: string | Date): this {
    this.#flags.push(option("start", isoTime(timestamp)));
    return this;
  }

  /** Logs up to this timestamp; needs {@link start} (`--end`). */
  end(timestamp: string | Date): this {
    this.#flags.push(option("end", isoTime(timestamp)));
    return this;
  }

  /**
   * Print the logs available now and exit, instead of following them
   * (`--once`). Without it the command streams until stopped, so a build
   * almost always wants this.
   */
  once(): this {
    this.#flags.push("--once");
    return this;
  }

  /** `deno deploy logs`. */
  protected override commandPath(): string[] {
    return ["logs"];
  }

  /** The time-range flags. */
  protected override commandArgs(): string[] {
    return [...this.#flags];
  }
}

/** A deployment's build status, for filtering (`--status`). */
export type DenoDeploymentStatus =
  | "skipped"
  | "queued"
  | "building"
  | "succeeded"
  | "failed";

/** Settings for `deno deploy deployments list`. */
export class DenoDeployDeploymentsListSettings
  extends DenoDeployCommandSettings {
  #flags: string[] = [];

  /** At most this many deployments (`--limit`). */
  limit(count: number): this {
    this.#flags.push(option("limit", limit("deploymentsList", count)));
    return this;
  }

  /** Continue from a previous `--json` page's cursor (`--cursor`). */
  cursor(cursor: string): this {
    this.#flags.push(option("cursor", cursor));
    return this;
  }

  /** Only deployments with this status (`--status`). */
  status(status: DenoDeploymentStatus): this {
    this.#flags.push(option("status", status));
    return this;
  }

  /** `deno deploy deployments list`. */
  protected override commandPath(): string[] {
    return ["deployments", "list"];
  }

  /** The paging and filter flags. */
  protected override commandArgs(): string[] {
    return [...this.#flags];
  }
}

/** Settings for `deno deploy apps list`. */
export class DenoDeployAppsListSettings extends DenoDeployCommandSettings {
  #limit?: number;

  /** At most this many applications (`--limit`). */
  limit(count: number): this {
    this.#limit = limit("appsList", count);
    return this;
  }

  /** `deno deploy apps list`. */
  protected override commandPath(): string[] {
    return ["apps", "list"];
  }

  /** `--limit`, when set. */
  protected override commandArgs(): string[] {
    return this.#limit === undefined ? [] : [option("limit", this.#limit)];
  }
}

/**
 * A read-only `deno deploy` command that takes only the shared flags.
 */
export type DenoDeployQueryCommand = "apps get" | "orgs list" | "whoami";

/**
 * Settings for the read-only commands with no flags of their own:
 * `deno deploy apps get`, `deno deploy orgs list` and `deno deploy whoami`.
 */
export class DenoDeployQuerySettings extends DenoDeployCommandSettings {
  readonly #command: DenoDeployQueryCommand;

  /** Settings for `deno deploy <command>`. */
  constructor(command: DenoDeployQueryCommand) {
    super();
    this.#command = command;
  }

  /** The command's path, e.g. `apps get`. */
  protected override commandPath(): string[] {
    return this.#command.split(" ");
  }

  /** No arguments of its own. */
  protected override commandArgs(): string[] {
    return [];
  }
}
