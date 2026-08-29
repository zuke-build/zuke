// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `gh run` — the GitHub Actions runs a build reads and drives: list, view,
 * rerun, cancel, delete, download, and watch.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * const failed = await GhTasks.runListEntries((s) => s.status("failure").limit(20));
 * await GhTasks.runRerun((s) => s.selector(failed[0].databaseId ?? 0).failed());
 * await GhTasks.runDownload((s) => s.selector(123).name("coverage").dir("artifacts"));
 * ```
 *
 * gh picks a run interactively when the operand is omitted, and a build has no
 * one to answer that picker — so every command here takes its run id.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import {
  GhCommandSettings,
  GhReadSettings,
  GhWebReadSettings,
} from "./subcommand.ts";
import { numberField, parseJsonArray, stringField } from "./json_array.ts";

/**
 * The status `gh run list --status` filters by: the run's state while it is
 * going, then the conclusion it settles on.
 */
export type GhRunStatus =
  | "queued"
  | "completed"
  | "in_progress"
  | "requested"
  | "waiting"
  | "pending"
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "skipped"
  | "stale"
  | "startup_failure"
  | "success"
  | "timed_out";

/**
 * Base for the `run` commands that name one run. gh prompts for a run when the
 * operand is omitted, so unlike a pull request there is no useful default.
 */
export abstract class GhRunTargetSettings extends GhCommandSettings {
  #selector?: string;

  /** The run — its id (required). */
  selector(runId: string | number): this {
    this.#selector = String(runId);
    return this;
  }

  /** The run id, or the failure explaining that gh would otherwise prompt. */
  protected requireSelector(task: string): string {
    if (this.#selector === undefined) {
      throw new Error(
        `GhTasks.${task}: .selector(...) is required — without a run id gh ` +
          "shows a picker, and a build has no one to answer it.",
      );
    }
    return this.#selector;
  }
}

/** Settings for `gh run list`. */
export class GhRunListSettings extends GhReadSettings {
  #all = false;
  #branch?: string;
  #commit?: string;
  #created?: string;
  #event?: string;
  #status?: GhRunStatus;
  #user?: string;
  #workflow?: string;
  #limit?: number;

  /** Include runs of disabled workflows (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Filter by branch (`--branch`). */
  branch(name: string): this {
    this.#branch = name;
    return this;
  }

  /** Filter by the commit that triggered them (`--commit`). */
  commit(sha: string): this {
    this.#commit = sha;
    return this;
  }

  /** Filter by creation date (`--created`), in GitHub's date-query syntax. */
  created(query: string): this {
    this.#created = query;
    return this;
  }

  /** Filter by the event that triggered them (`--event`). */
  event(name: string): this {
    this.#event = name;
    return this;
  }

  /** Filter by status or conclusion (`--status`). */
  status(value: GhRunStatus): this {
    this.#status = value;
    return this;
  }

  /** Filter by the user who triggered them (`--user`). */
  user(login: string): this {
    this.#user = login;
    return this;
  }

  /** Filter by workflow, by name, id, or file name (`--workflow`). */
  workflow(nameOrId: string): this {
    this.#workflow = nameOrId;
    return this;
  }

  /** Cap how many are fetched (`--limit`); gh's default is 20. */
  limit(count: number): this {
    this.#limit = count;
    return this;
  }

  /** The `gh run list` command path. */
  protected override commandPath(): string[] {
    return ["run", "list"];
  }

  /** Assemble the `gh run list` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#all) argv.push("--all");
    if (this.#branch !== undefined) argv.push("--branch", this.#branch);
    if (this.#commit !== undefined) argv.push("--commit", this.#commit);
    if (this.#created !== undefined) argv.push("--created", this.#created);
    if (this.#event !== undefined) argv.push("--event", this.#event);
    if (this.#status !== undefined) argv.push("--status", this.#status);
    if (this.#user !== undefined) argv.push("--user", this.#user);
    if (this.#workflow !== undefined) argv.push("--workflow", this.#workflow);
    if (this.#limit !== undefined) argv.push("--limit", String(this.#limit));
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh run view`. */
export class GhRunViewSettings extends GhWebReadSettings {
  #selector?: string;
  #attempt?: number;
  #job?: string;
  #log = false;
  #logFailed = false;
  #exitStatus = false;
  #verbose = false;

  /** The run — its id; gh shows a picker without one. */
  selector(runId: string | number): this {
    this.#selector = String(runId);
    return this;
  }

  /** View an earlier attempt (`--attempt`). */
  attempt(number: number): this {
    this.#attempt = number;
    return this;
  }

  /** View one job of the run (`--job`), by job id. */
  job(jobId: string | number): this {
    this.#job = String(jobId);
    return this;
  }

  /** Print the full log (`--log`). */
  log(): this {
    this.#log = true;
    return this;
  }

  /** Print only the failed steps' log (`--log-failed`). */
  logFailed(): this {
    this.#logFailed = true;
    return this;
  }

  /** Exit non-zero when the run failed (`--exit-status`). */
  exitStatus(): this {
    this.#exitStatus = true;
    return this;
  }

  /** Include the individual job steps (`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** The `gh run view` command path. */
  protected override commandPath(): string[] {
    if (this.#selector === undefined) {
      throw new Error(
        "GhTasks.runView: .selector(...) is required — without a run id gh " +
          "shows a picker, and a build has no one to answer it.",
      );
    }
    return ["run", "view", this.#selector];
  }

  /** Assemble the `gh run view` flags. */
  protected override commandFlags(): string[] {
    if (this.#log && this.#logFailed) {
      throw new Error(
        "GhTasks.runView: .log() prints every step and .logFailed() only the " +
          "failed ones — pick one.",
      );
    }
    const argv: string[] = [];
    if (this.#attempt !== undefined) {
      argv.push("--attempt", String(this.#attempt));
    }
    if (this.#job !== undefined) argv.push("--job", this.#job);
    if (this.#log) argv.push("--log");
    if (this.#logFailed) argv.push("--log-failed");
    if (this.#exitStatus) argv.push("--exit-status");
    if (this.#verbose) argv.push("--verbose");
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh run rerun`. */
export class GhRunRerunSettings extends GhRunTargetSettings {
  #failed = false;
  #job?: string;
  #debug = false;

  /** Rerun only the failed jobs and their dependencies (`--failed`). */
  failed(): this {
    this.#failed = true;
    return this;
  }

  /** Rerun one job and its dependencies (`--job`), by job id. */
  job(jobId: string | number): this {
    this.#job = String(jobId);
    return this;
  }

  /** Rerun with debug logging enabled (`--debug`). */
  debug(): this {
    this.#debug = true;
    return this;
  }

  /** The `gh run rerun` command path. */
  protected override commandPath(): string[] {
    return ["run", "rerun", this.requireSelector("runRerun")];
  }

  /** Assemble the `gh run rerun` flags. */
  protected override commandFlags(): string[] {
    if (this.#failed && this.#job !== undefined) {
      throw new Error(
        "GhTasks.runRerun: .failed() reruns every failed job and .job(...) " +
          "reruns one — pick one.",
      );
    }
    const argv: string[] = [];
    if (this.#failed) argv.push("--failed");
    if (this.#job !== undefined) argv.push("--job", this.#job);
    if (this.#debug) argv.push("--debug");
    return argv;
  }
}

/** Settings for `gh run cancel`. */
export class GhRunCancelSettings extends GhRunTargetSettings {
  #force = false;

  /** Cancel a run the ordinary request will not stop (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** The `gh run cancel` command path. */
  protected override commandPath(): string[] {
    return ["run", "cancel", this.requireSelector("runCancel")];
  }

  /** Assemble the `gh run cancel` flags. */
  protected override commandFlags(): string[] {
    return this.#force ? ["--force"] : [];
  }
}

/** Settings for `gh run delete`. */
export class GhRunDeleteSettings extends GhRunTargetSettings {
  /** The `gh run delete` command path. */
  protected override commandPath(): string[] {
    return ["run", "delete", this.requireSelector("runDelete")];
  }

  /** `gh run delete` takes no flags of its own. */
  protected override commandFlags(): string[] {
    return [];
  }
}

/** Settings for `gh run download`. */
export class GhRunDownloadSettings extends GhRunTargetSettings {
  #names: string[] = [];
  #patterns: string[] = [];
  #dir?: string;

  /** Only artifacts with this exact name (`--name`); repeatable. */
  name(...names: string[]): this {
    this.#names.push(...names);
    return this;
  }

  /** Only artifacts matching this glob (`--pattern`); repeatable. */
  pattern(...globs: string[]): this {
    this.#patterns.push(...globs);
    return this;
  }

  /** The directory to download into (`--dir`); gh's default is the cwd. */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** The `gh run download` command path. */
  protected override commandPath(): string[] {
    return ["run", "download", this.requireSelector("runDownload")];
  }

  /** Assemble the `gh run download` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    for (const name of this.#names) argv.push("--name", name);
    for (const glob of this.#patterns) argv.push("--pattern", glob);
    if (this.#dir !== undefined) argv.push("--dir", this.#dir);
    return argv;
  }
}

/** Settings for `gh run watch`. */
export class GhRunWatchSettings extends GhRunTargetSettings {
  #compact = false;
  #exitStatus = false;
  #interval?: number;

  /** Report only the relevant and failed steps (`--compact`). */
  compact(): this {
    this.#compact = true;
    return this;
  }

  /** Exit non-zero when the run fails (`--exit-status`). */
  exitStatus(): this {
    this.#exitStatus = true;
    return this;
  }

  /** Seconds between refreshes (`--interval`); gh's default is 3. */
  interval(seconds: number): this {
    this.#interval = seconds;
    return this;
  }

  /** The `gh run watch` command path. */
  protected override commandPath(): string[] {
    return ["run", "watch", this.requireSelector("runWatch")];
  }

  /** Assemble the `gh run watch` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#compact) argv.push("--compact");
    if (this.#exitStatus) argv.push("--exit-status");
    if (this.#interval !== undefined) {
      argv.push("--interval", String(this.#interval));
    }
    return argv;
  }
}

/** One workflow run of {@link "./gh.ts".GhTasks.runListEntries}. */
export interface GhRunEntry {
  /** The run's numeric id — what every other `run` command takes. */
  databaseId?: number;
  /** Its number within its workflow. */
  number?: number;
  /** The title GitHub displays, usually the head commit's subject. */
  displayTitle?: string;
  /** The name of the workflow it ran. */
  workflowName?: string;
  /** The branch it ran on. */
  headBranch?: string;
  /** The event that triggered it. */
  event?: string;
  /** Its status, as gh reports it: `completed`, `in_progress`, … */
  status?: string;
  /** Its conclusion once complete: `success`, `failure`, … */
  conclusion?: string;
  /** Its web URL. */
  url?: string;
  /** When it was created, ISO 8601. */
  createdAt?: string;
}

/**
 * The `--json` fields {@link readRuns} asks for; gh requires the list by name,
 * so the reader pins the set {@link GhRunEntry} describes.
 */
export const RUN_LIST_FIELDS: readonly string[] = [
  "databaseId",
  "number",
  "displayTitle",
  "workflowName",
  "headBranch",
  "event",
  "status",
  "conclusion",
  "url",
  "createdAt",
];

/**
 * Parse `gh run list --json …` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseRuns(stdout: string): GhRunEntry[] {
  return parseJsonArray(stdout).map((record) => {
    const entry: GhRunEntry = {};
    const databaseId = numberField(record, "databaseId");
    const number = numberField(record, "number");
    const displayTitle = stringField(record, "displayTitle");
    const workflowName = stringField(record, "workflowName");
    const headBranch = stringField(record, "headBranch");
    const event = stringField(record, "event");
    const status = stringField(record, "status");
    const conclusion = stringField(record, "conclusion");
    const url = stringField(record, "url");
    const createdAt = stringField(record, "createdAt");
    if (databaseId !== undefined) entry.databaseId = databaseId;
    if (number !== undefined) entry.number = number;
    if (displayTitle !== undefined) entry.displayTitle = displayTitle;
    if (workflowName !== undefined) entry.workflowName = workflowName;
    if (headBranch !== undefined) entry.headBranch = headBranch;
    if (event !== undefined) entry.event = event;
    if (status !== undefined) entry.status = status;
    if (conclusion !== undefined) entry.conclusion = conclusion;
    if (url !== undefined) entry.url = url;
    if (createdAt !== undefined) entry.createdAt = createdAt;
    return entry;
  });
}

/**
 * Run `gh run list --json …` and parse it. Backs
 * {@link "./gh.ts".GhTasks.runListEntries}.
 */
export async function readRuns(
  configure?: Configure<GhRunListSettings>,
): Promise<GhRunEntry[]> {
  const settings = new GhRunListSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.json(...RUN_LIST_FIELDS).run();
  return parseRuns(output.stdout);
}
