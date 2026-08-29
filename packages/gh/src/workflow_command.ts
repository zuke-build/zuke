// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `gh workflow` — listing, viewing, dispatching, enabling and disabling the
 * Actions workflows of a repository.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * await GhTasks.workflowRun((s) => s.workflow("e2e.yml").ref("main").field("env", "staging"));
 * await GhTasks.workflowDisable((s) => s.workflow("nightly.yml"));
 * const workflows = await GhTasks.workflowListEntries((s) => s.all());
 * ```
 *
 * This is the `gh workflow` CLI. {@link "./workflow.ts".githubWorkflow} is the
 * other half of the same story: a wait trigger that dispatches a workflow over
 * REST and suspends the run until it finishes. Reach for the trigger when the
 * build must wait for the result, and for `workflowRun` when it only needs the
 * dispatch.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GhCommandSettings, GhReadSettings } from "./subcommand.ts";
import { numberField, parseJsonArray, stringField } from "./json_array.ts";

/**
 * Base for the `workflow` commands that name one workflow, which gh takes by
 * file name, name, or numeric id.
 */
export abstract class GhWorkflowTargetSettings extends GhCommandSettings {
  #workflow?: string;

  /** The workflow — its file name, its name, or its id (required). */
  workflow(nameOrId: string | number): this {
    this.#workflow = String(nameOrId);
    return this;
  }

  /** The workflow operand, or the failure explaining that gh would prompt. */
  protected requireWorkflow(task: string): string {
    if (this.#workflow === undefined) {
      throw new Error(
        `GhTasks.${task}: .workflow(...) is required — without it gh shows a ` +
          "picker, and a build has no one to answer it.",
      );
    }
    return this.#workflow;
  }
}

/** Settings for `gh workflow list`. */
export class GhWorkflowListSettings extends GhReadSettings {
  #all = false;
  #limit?: number;

  /** Include disabled workflows (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Cap how many are fetched (`--limit`); gh's default is 50. */
  limit(count: number): this {
    this.#limit = count;
    return this;
  }

  /** The `gh workflow list` command path. */
  protected override commandPath(): string[] {
    return ["workflow", "list"];
  }

  /** Assemble the `gh workflow list` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#all) argv.push("--all");
    if (this.#limit !== undefined) argv.push("--limit", String(this.#limit));
    argv.push(...this.readFlags());
    return argv;
  }
}

/**
 * Settings for `gh workflow view`.
 *
 * Unlike the other viewing commands this one prints no JSON — gh gives it
 * `--yaml` and `--web` but no `--json` — so it does not carry the read flags.
 */
export class GhWorkflowViewSettings extends GhWorkflowTargetSettings {
  #ref?: string;
  #yaml = false;
  #web = false;

  /** The branch or tag holding the version to view (`--ref`). */
  ref(name: string): this {
    this.#ref = name;
    return this;
  }

  /** Print the workflow's YAML rather than its summary (`--yaml`). */
  yaml(): this {
    this.#yaml = true;
    return this;
  }

  /**
   * Open it in a browser instead of printing it (`--web`). A build has no
   * browser, so this is for a developer running the target by hand.
   */
  web(): this {
    this.#web = true;
    return this;
  }

  /** The `gh workflow view` command path. */
  protected override commandPath(): string[] {
    return ["workflow", "view", this.requireWorkflow("workflowView")];
  }

  /** Assemble the `gh workflow view` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#ref !== undefined) argv.push("--ref", this.#ref);
    if (this.#yaml) argv.push("--yaml");
    if (this.#web) argv.push("--web");
    return argv;
  }
}

/** Settings for `gh workflow run` — dispatching a `workflow_dispatch` run. */
export class GhWorkflowRunSettings extends GhWorkflowTargetSettings {
  #ref?: string;
  #fields: Array<[string, string]> = [];
  #rawFields: Array<[string, string]> = [];
  #json = false;

  /** The branch or tag to run it on (`--ref`). */
  ref(name: string): this {
    this.#ref = name;
    return this;
  }

  /**
   * An input, as `--field key=value`. gh reads a leading `@` in the value as
   * a file to read, so use {@link rawField} for a value that starts with one.
   */
  field(key: string, value: string | number | boolean): this {
    this.#fields.push([key, String(value)]);
    return this;
  }

  /** An input passed verbatim (`--raw-field`), with no `@` file syntax. */
  rawField(key: string, value: string | number | boolean): this {
    this.#rawFields.push([key, String(value)]);
    return this;
  }

  /** Read the whole input object as JSON on standard input (`--json`). */
  jsonInput(): this {
    this.#json = true;
    return this;
  }

  /** The `gh workflow run` command path. */
  protected override commandPath(): string[] {
    return ["workflow", "run", this.requireWorkflow("workflowRun")];
  }

  /** Assemble the `gh workflow run` flags. */
  protected override commandFlags(): string[] {
    const named = this.#fields.length + this.#rawFields.length;
    if (this.#json && named > 0) {
      throw new Error(
        "GhTasks.workflowRun: .jsonInput() reads every input from standard " +
          "input, which .field(...)/.rawField(...) would not reach — pick one.",
      );
    }
    const argv: string[] = [];
    if (this.#ref !== undefined) argv.push("--ref", this.#ref);
    for (const [key, value] of this.#fields) {
      argv.push("--field", `${key}=${value}`);
    }
    for (const [key, value] of this.#rawFields) {
      argv.push("--raw-field", `${key}=${value}`);
    }
    if (this.#json) argv.push("--json");
    return argv;
  }
}

/** Settings for `gh workflow enable`. */
export class GhWorkflowEnableSettings extends GhWorkflowTargetSettings {
  /** The `gh workflow enable` command path. */
  protected override commandPath(): string[] {
    return ["workflow", "enable", this.requireWorkflow("workflowEnable")];
  }

  /** `gh workflow enable` takes no flags of its own. */
  protected override commandFlags(): string[] {
    return [];
  }
}

/** Settings for `gh workflow disable`. */
export class GhWorkflowDisableSettings extends GhWorkflowTargetSettings {
  /** The `gh workflow disable` command path. */
  protected override commandPath(): string[] {
    return ["workflow", "disable", this.requireWorkflow("workflowDisable")];
  }

  /** `gh workflow disable` takes no flags of its own. */
  protected override commandFlags(): string[] {
    return [];
  }
}

/** One workflow of {@link "./gh.ts".GhTasks.workflowListEntries}. */
export interface GhWorkflowEntry {
  /** The workflow's numeric id. */
  id?: number;
  /** Its name, as the `name:` key of its file declares it. */
  name?: string;
  /** Its path in the repository, e.g. `.github/workflows/ci.yml`. */
  path?: string;
  /** Its state, as gh reports it: `active`, `disabled_manually`, … */
  state?: string;
}

/**
 * The `--json` fields {@link readWorkflows} asks for; gh requires the list by
 * name, so the reader pins the set {@link GhWorkflowEntry} describes.
 */
export const WORKFLOW_LIST_FIELDS: readonly string[] = [
  "id",
  "name",
  "path",
  "state",
];

/**
 * Parse `gh workflow list --json …` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseWorkflows(stdout: string): GhWorkflowEntry[] {
  return parseJsonArray(stdout).map((record) => {
    const entry: GhWorkflowEntry = {};
    const id = numberField(record, "id");
    const name = stringField(record, "name");
    const path = stringField(record, "path");
    const state = stringField(record, "state");
    if (id !== undefined) entry.id = id;
    if (name !== undefined) entry.name = name;
    if (path !== undefined) entry.path = path;
    if (state !== undefined) entry.state = state;
    return entry;
  });
}

/**
 * Run `gh workflow list --json …` and parse it. Backs
 * {@link "./gh.ts".GhTasks.workflowListEntries}.
 */
export async function readWorkflows(
  configure?: Configure<GhWorkflowListSettings>,
): Promise<GhWorkflowEntry[]> {
  const settings = new GhWorkflowListSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.json(...WORKFLOW_LIST_FIELDS).run();
  return parseWorkflows(output.stdout);
}
