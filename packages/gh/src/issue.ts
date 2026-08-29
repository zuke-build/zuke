// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `gh issue` — the issue commands a build drives: create, list, view,
 * comment, and close.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * await GhTasks.issueCreate((s) => s.title("flaky test").body(details).label("bug"));
 * await GhTasks.issueClose((s) => s.selector(42).reason("completed"));
 * const bugs = await GhTasks.issueListEntries((s) => s.label("bug"));
 * ```
 *
 * Unlike a pull request, gh has no "issue for the current branch", so every
 * command here takes its number or URL — which is why `.selector(...)` is
 * required rather than optional.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import {
  GhBodySettings,
  GhCommandSettings,
  GhWebReadSettings,
} from "./subcommand.ts";
import {
  loginField,
  numberField,
  parseJsonArray,
  stringField,
} from "./json_array.ts";

/** Settings for `gh issue create`. */
export class GhIssueCreateSettings extends GhBodySettings {
  #title?: string;
  #assignees: string[] = [];
  #labels: string[] = [];
  #projects: string[] = [];
  #milestone?: string;
  #type?: string;
  #parent?: string;
  #template?: string;

  /** The issue's title (`--title`). */
  title(text: string): this {
    this.#title = text;
    return this;
  }

  /** Assign someone by login (`--assignee`), `@me` for yourself; repeatable. */
  assignee(...logins: string[]): this {
    this.#assignees.push(...logins);
    return this;
  }

  /** Add a label by name (`--label`); repeatable. */
  label(...names: string[]): this {
    this.#labels.push(...names);
    return this;
  }

  /** Add to a project by title (`--project`); repeatable. */
  project(...titles: string[]): this {
    this.#projects.push(...titles);
    return this;
  }

  /** Add to a milestone by name (`--milestone`). */
  milestone(name: string): this {
    this.#milestone = name;
    return this;
  }

  /** Set the issue type by name (`--type`). */
  type(name: string): this {
    this.#type = name;
    return this;
  }

  /** File it as a sub-issue of this number or URL (`--parent`). */
  parent(numberOrUrl: string | number): this {
    this.#parent = String(numberOrUrl);
    return this;
  }

  /** The issue template to start the body from (`--template`). */
  templateName(name: string): this {
    this.#template = name;
    return this;
  }

  /** The `gh issue create` command path. */
  protected override commandPath(): string[] {
    return ["issue", "create"];
  }

  /** Assemble the `gh issue create` flags. */
  protected override commandFlags(): string[] {
    if (this.#title === undefined) {
      throw new Error(
        "GhTasks.issueCreate: .title(...) is required — without it gh prompts, " +
          "and a build has no one to answer.",
      );
    }
    const argv = ["--title", this.#title, ...this.bodyFlags("issueCreate")];
    for (const login of this.#assignees) argv.push("--assignee", login);
    for (const name of this.#labels) argv.push("--label", name);
    for (const title of this.#projects) argv.push("--project", title);
    if (this.#milestone !== undefined) {
      argv.push("--milestone", this.#milestone);
    }
    if (this.#type !== undefined) argv.push("--type", this.#type);
    if (this.#parent !== undefined) argv.push("--parent", this.#parent);
    if (this.#template !== undefined) argv.push("--template", this.#template);
    return argv;
  }
}

/** Settings for `gh issue list`. */
export class GhIssueListSettings extends GhWebReadSettings {
  #state?: string;
  #author?: string;
  #app?: string;
  #assignee?: string;
  #mention?: string;
  #milestone?: string;
  #type?: string;
  #labels: string[] = [];
  #limit?: number;
  #search?: string;

  /** Filter by state (`--state`): `open`, `closed`, or `all`. */
  state(value: "open" | "closed" | "all"): this {
    this.#state = value;
    return this;
  }

  /** Filter by author (`--author`). */
  author(login: string): this {
    this.#author = login;
    return this;
  }

  /** Filter by the GitHub App that opened it (`--app`). */
  app(name: string): this {
    this.#app = name;
    return this;
  }

  /** Filter by assignee (`--assignee`). */
  assignee(login: string): this {
    this.#assignee = login;
    return this;
  }

  /** Filter by who is mentioned (`--mention`). */
  mention(login: string): this {
    this.#mention = login;
    return this;
  }

  /** Filter by milestone number or title (`--milestone`). */
  milestone(nameOrNumber: string): this {
    this.#milestone = nameOrNumber;
    return this;
  }

  /** Filter by issue type (`--type`). */
  type(name: string): this {
    this.#type = name;
    return this;
  }

  /** Filter by label (`--label`); repeatable. */
  label(...names: string[]): this {
    this.#labels.push(...names);
    return this;
  }

  /** Cap how many are fetched (`--limit`); gh's default is 30. */
  limit(count: number): this {
    this.#limit = count;
    return this;
  }

  /** Filter with a search query (`--search`). */
  search(query: string): this {
    this.#search = query;
    return this;
  }

  /** The `gh issue list` command path. */
  protected override commandPath(): string[] {
    return ["issue", "list"];
  }

  /** Assemble the `gh issue list` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#state !== undefined) argv.push("--state", this.#state);
    if (this.#author !== undefined) argv.push("--author", this.#author);
    if (this.#app !== undefined) argv.push("--app", this.#app);
    if (this.#assignee !== undefined) argv.push("--assignee", this.#assignee);
    if (this.#mention !== undefined) argv.push("--mention", this.#mention);
    if (this.#milestone !== undefined) {
      argv.push("--milestone", this.#milestone);
    }
    if (this.#type !== undefined) argv.push("--type", this.#type);
    for (const name of this.#labels) argv.push("--label", name);
    if (this.#search !== undefined) argv.push("--search", this.#search);
    if (this.#limit !== undefined) argv.push("--limit", String(this.#limit));
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh issue view`. */
export class GhIssueViewSettings extends GhWebReadSettings {
  #selector?: string;
  #comments = false;

  /** The issue — its number or URL (required). */
  selector(value: string | number): this {
    this.#selector = String(value);
    return this;
  }

  /** Include the comments (`--comments`). */
  comments(): this {
    this.#comments = true;
    return this;
  }

  /** The `gh issue view` command path. */
  protected override commandPath(): string[] {
    if (this.#selector === undefined) {
      throw new Error(
        "GhTasks.issueView: .selector(...) is required — gh has no issue for " +
          "the current branch the way it has a pull request.",
      );
    }
    return ["issue", "view", this.#selector];
  }

  /** Assemble the `gh issue view` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#comments) argv.push("--comments");
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh issue comment`. */
export class GhIssueCommentSettings extends GhBodySettings {
  #selector?: string;
  #editLast = false;
  #createIfNone = false;
  #deleteLast = false;
  #yes = false;

  /** The issue — its number or URL (required). */
  selector(value: string | number): this {
    this.#selector = String(value);
    return this;
  }

  /** Edit your most recent comment instead of adding one (`--edit-last`). */
  editLast(): this {
    this.#editLast = true;
    return this;
  }

  /** With {@link editLast}, post a new comment when there is none (`--create-if-none`). */
  createIfNone(): this {
    this.#createIfNone = true;
    return this;
  }

  /** Delete your most recent comment (`--delete-last`). */
  deleteLast(): this {
    this.#deleteLast = true;
    return this;
  }

  /** Skip the confirmation a delete otherwise prompts for (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** The `gh issue comment` command path. */
  protected override commandPath(): string[] {
    if (this.#selector === undefined) {
      throw new Error(
        "GhTasks.issueComment: .selector(...) is required — it names the " +
          "issue to comment on.",
      );
    }
    return ["issue", "comment", this.#selector];
  }

  /** Assemble the `gh issue comment` flags. */
  protected override commandFlags(): string[] {
    if (this.#deleteLast && !this.#yes) {
      throw new Error(
        "GhTasks.issueComment: .deleteLast() prompts for confirmation, which " +
          "a build cannot answer — add .yes() to mean it.",
      );
    }
    if (this.#createIfNone && !this.#editLast) {
      throw new Error(
        "GhTasks.issueComment: .createIfNone() qualifies .editLast() — add " +
          "it, or drop .createIfNone().",
      );
    }
    const argv = [...this.bodyFlags("issueComment")];
    if (this.#editLast) argv.push("--edit-last");
    if (this.#createIfNone) argv.push("--create-if-none");
    if (this.#deleteLast) argv.push("--delete-last");
    if (this.#yes) argv.push("--yes");
    return argv;
  }
}

/** Why an issue is being closed (`--reason`). */
export type GhCloseReason = "completed" | "not planned" | "duplicate";

/** Settings for `gh issue close`. */
export class GhIssueCloseSettings extends GhCommandSettings {
  #selector?: string;
  #comment?: string;
  #reason?: GhCloseReason;
  #duplicateOf?: string;

  /** The issue — its number or URL (required). */
  selector(value: string | number): this {
    this.#selector = String(value);
    return this;
  }

  /** Leave a closing comment (`--comment`). */
  comment(text: string): this {
    this.#comment = text;
    return this;
  }

  /** Why it is closed (`--reason`). */
  reason(value: GhCloseReason): this {
    this.#reason = value;
    return this;
  }

  /** Which issue it duplicates (`--duplicate-of`), by number or URL. */
  duplicateOf(numberOrUrl: string | number): this {
    this.#duplicateOf = String(numberOrUrl);
    return this;
  }

  /** The `gh issue close` command path. */
  protected override commandPath(): string[] {
    if (this.#selector === undefined) {
      throw new Error(
        "GhTasks.issueClose: .selector(...) is required — it names the issue " +
          "to close.",
      );
    }
    return ["issue", "close", this.#selector];
  }

  /** Assemble the `gh issue close` flags. */
  protected override commandFlags(): string[] {
    if (this.#duplicateOf !== undefined && this.#reason !== "duplicate") {
      throw new Error(
        'GhTasks.issueClose: .duplicateOf(...) goes with .reason("duplicate") ' +
          "— set that reason, or drop it.",
      );
    }
    const argv: string[] = [];
    if (this.#comment !== undefined) argv.push("--comment", this.#comment);
    if (this.#reason !== undefined) argv.push("--reason", this.#reason);
    if (this.#duplicateOf !== undefined) {
      argv.push("--duplicate-of", this.#duplicateOf);
    }
    return argv;
  }
}

/** One issue of {@link "./gh.ts".GhTasks.issueListEntries}. */
export interface GhIssueEntry {
  /** The issue's number. */
  number?: number;
  /** Its title. */
  title?: string;
  /** Its state, as gh reports it: `OPEN` or `CLOSED`. */
  state?: string;
  /** Its web URL. */
  url?: string;
  /** The login of whoever opened it. */
  author?: string;
}

/**
 * The `--json` fields {@link readIssues} asks for; gh requires the list by
 * name, so the reader pins the set {@link GhIssueEntry} describes.
 */
export const ISSUE_LIST_FIELDS: readonly string[] = [
  "number",
  "title",
  "state",
  "url",
  "author",
];

/**
 * Parse `gh issue list --json …` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseIssues(stdout: string): GhIssueEntry[] {
  return parseJsonArray(stdout).map((record) => {
    const entry: GhIssueEntry = {};
    const number = numberField(record, "number");
    const title = stringField(record, "title");
    const state = stringField(record, "state");
    const url = stringField(record, "url");
    const author = loginField(record, "author");
    if (number !== undefined) entry.number = number;
    if (title !== undefined) entry.title = title;
    if (state !== undefined) entry.state = state;
    if (url !== undefined) entry.url = url;
    if (author !== undefined) entry.author = author;
    return entry;
  });
}

/**
 * Run `gh issue list --json …` and parse it. Backs
 * {@link "./gh.ts".GhTasks.issueListEntries}.
 */
export async function readIssues(
  configure?: Configure<GhIssueListSettings>,
): Promise<GhIssueEntry[]> {
  const settings = new GhIssueListSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.json(...ISSUE_LIST_FIELDS).run();
  return parseIssues(output.stdout);
}
