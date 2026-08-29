// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `gh pr` — the pull-request commands a build drives: create, list, view,
 * merge, checks, comment, edit, and close.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * await GhTasks.prMerge((s) => s.selector("123").squash().deleteBranch());
 * const open = await GhTasks.prListEntries((s) => s.state("open"));
 * ```
 *
 * Every flag here is gh's own, taken from its manual. Where a command takes a
 * pull request, gh accepts a number, a URL, or a branch name, and falls back
 * to the PR for the current branch when none is given — so `.selector(...)` is
 * optional on those, exactly as on the command line.
 *
 * {@link "./gh.ts".GhTasks.pullRequest} remains the REST path for *creating*
 * one: it needs a token but no `gh` binary, where {@link GhPrCreateSettings}
 * needs `gh` and its own auth. Reach for whichever the build already has.
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
  booleanField,
  loginField,
  numberField,
  parseJsonArray,
  stringField,
} from "./json_array.ts";

/**
 * The operand naming the pull request, when one was given. gh falls back to
 * the PR for the current branch, so an unset selector renders nothing rather
 * than an empty argument.
 */
function selectorOperand(selector: string | undefined): string[] {
  return selector === undefined ? [] : [selector];
}

/**
 * Base for the `pr` commands that take a pull request and post text —
 * `merge`, `comment`, and `edit` — so the operand and the `--body` pair have
 * one implementation across them.
 */
export abstract class GhPrTargetSettings extends GhBodySettings {
  #selector?: string;

  /**
   * The pull request — its number, URL, or branch name. Omit it to act on the
   * PR for the current branch, as gh does.
   */
  selector(value: string | number): this {
    this.#selector = String(value);
    return this;
  }

  /** The operand, when one was given. */
  protected selectorArgs(): string[] {
    return selectorOperand(this.#selector);
  }
}

/** Settings for `gh pr create`. */
export class GhPrCreateSettings extends GhBodySettings {
  #title?: string;
  #base?: string;
  #head?: string;
  #assignees: string[] = [];
  #labels: string[] = [];
  #reviewers: string[] = [];
  #milestone?: string;
  #projects: string[] = [];
  #draft = false;
  #fill = false;
  #fillFirst = false;
  #fillVerbose = false;
  #dryRun = false;
  #noMaintainerEdit = false;
  #template?: string;

  /** The pull request's title (`--title`). */
  title(text: string): this {
    this.#title = text;
    return this;
  }

  /** The branch to merge into (`--base`). */
  base(branch: string): this {
    this.#base = branch;
    return this;
  }

  /** The branch holding the commits (`--head`). */
  head(branch: string): this {
    this.#head = branch;
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

  /** Request a review from a person or team (`--reviewer`); repeatable. */
  reviewer(...handles: string[]): this {
    this.#reviewers.push(...handles);
    return this;
  }

  /** Add to a milestone by name (`--milestone`). */
  milestone(name: string): this {
    this.#milestone = name;
    return this;
  }

  /** Add to a project by title (`--project`); repeatable. */
  project(...titles: string[]): this {
    this.#projects.push(...titles);
    return this;
  }

  /** Open it as a draft (`--draft`). */
  draft(): this {
    this.#draft = true;
    return this;
  }

  /** Take the title and body from the commits (`--fill`). */
  fill(): this {
    this.#fill = true;
    return this;
  }

  /** Take them from the first commit only (`--fill-first`). */
  fillFirst(): this {
    this.#fillFirst = true;
    return this;
  }

  /** Take the body from every commit's message (`--fill-verbose`). */
  fillVerbose(): this {
    this.#fillVerbose = true;
    return this;
  }

  /** Print what would be created without creating it (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Refuse maintainer edits to the branch (`--no-maintainer-edit`). */
  noMaintainerEdit(): this {
    this.#noMaintainerEdit = true;
    return this;
  }

  /** A template file to seed the body from (`--template`). */
  templateFile(path: string): this {
    this.#template = path;
    return this;
  }

  /** The `gh pr create` command path. */
  protected override commandPath(): string[] {
    return ["pr", "create"];
  }

  /** Assemble the `gh pr create` flags. */
  protected override commandFlags(): string[] {
    const fills = [this.#fill, this.#fillFirst, this.#fillVerbose]
      .filter(Boolean).length;
    if (fills > 1) {
      throw new Error(
        "GhTasks.prCreate: .fill(), .fillFirst(), and .fillVerbose() are " +
          "three ways to take the same text from the commits — pick one.",
      );
    }
    const argv: string[] = [];
    if (this.#title !== undefined) argv.push("--title", this.#title);
    argv.push(...this.bodyFlags("prCreate"));
    if (this.#base !== undefined) argv.push("--base", this.#base);
    if (this.#head !== undefined) argv.push("--head", this.#head);
    if (this.#draft) argv.push("--draft");
    if (this.#fill) argv.push("--fill");
    if (this.#fillFirst) argv.push("--fill-first");
    if (this.#fillVerbose) argv.push("--fill-verbose");
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#noMaintainerEdit) argv.push("--no-maintainer-edit");
    for (const login of this.#assignees) argv.push("--assignee", login);
    for (const name of this.#labels) argv.push("--label", name);
    for (const handle of this.#reviewers) argv.push("--reviewer", handle);
    for (const title of this.#projects) argv.push("--project", title);
    if (this.#milestone !== undefined) {
      argv.push("--milestone", this.#milestone);
    }
    if (this.#template !== undefined) argv.push("--template", this.#template);
    return argv;
  }
}

/** Settings for `gh pr list`. */
export class GhPrListSettings extends GhWebReadSettings {
  #state?: string;
  #base?: string;
  #head?: string;
  #author?: string;
  #app?: string;
  #assignee?: string;
  #labels: string[] = [];
  #limit?: number;
  #search?: string;
  #draft = false;

  /** Filter by state (`--state`): `open`, `closed`, `merged`, or `all`. */
  state(value: "open" | "closed" | "merged" | "all"): this {
    this.#state = value;
    return this;
  }

  /** Filter by base branch (`--base`). */
  base(branch: string): this {
    this.#base = branch;
    return this;
  }

  /** Filter by head branch (`--head`). */
  head(branch: string): this {
    this.#head = branch;
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

  /** Only draft pull requests (`--draft`). */
  draft(): this {
    this.#draft = true;
    return this;
  }

  /** The `gh pr list` command path. */
  protected override commandPath(): string[] {
    return ["pr", "list"];
  }

  /** Assemble the `gh pr list` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#state !== undefined) argv.push("--state", this.#state);
    if (this.#base !== undefined) argv.push("--base", this.#base);
    if (this.#head !== undefined) argv.push("--head", this.#head);
    if (this.#author !== undefined) argv.push("--author", this.#author);
    if (this.#app !== undefined) argv.push("--app", this.#app);
    if (this.#assignee !== undefined) argv.push("--assignee", this.#assignee);
    for (const name of this.#labels) argv.push("--label", name);
    if (this.#search !== undefined) argv.push("--search", this.#search);
    if (this.#draft) argv.push("--draft");
    if (this.#limit !== undefined) argv.push("--limit", String(this.#limit));
    argv.push(...this.readFlags());
    return argv;
  }
}

/**
 * Base for the `pr` commands that read one pull request and can print JSON —
 * `view` and `checks` — so the operand has one implementation across them.
 */
export abstract class GhPrReadSettings extends GhWebReadSettings {
  #selector?: string;

  /** The pull request — number, URL, or branch; defaults to the current branch's. */
  selector(value: string | number): this {
    this.#selector = String(value);
    return this;
  }

  /** The operand, when one was given. */
  protected selectorArgs(): string[] {
    return selectorOperand(this.#selector);
  }
}

/** Settings for `gh pr view`. */
export class GhPrViewSettings extends GhPrReadSettings {
  #comments = false;

  /** Include the comments (`--comments`). */
  comments(): this {
    this.#comments = true;
    return this;
  }

  /** The `gh pr view` command path. */
  protected override commandPath(): string[] {
    return ["pr", "view", ...this.selectorArgs()];
  }

  /** Assemble the `gh pr view` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#comments) argv.push("--comments");
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh pr checks`. */
export class GhPrChecksSettings extends GhPrReadSettings {
  #watch = false;
  #failFast = false;
  #required = false;
  #interval?: number;

  /**
   * Keep watching until the checks finish (`--watch`). A target that watches
   * blocks until CI is done, so pair it with `.killAfter(...)` unless the wait
   * is the point.
   */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Stop watching at the first failure (`--fail-fast`). */
  failFast(): this {
    this.#failFast = true;
    return this;
  }

  /** Only the checks marked required (`--required`). */
  required(): this {
    this.#required = true;
    return this;
  }

  /** How often to refresh while watching (`--interval`), in seconds. */
  interval(seconds: number): this {
    this.#interval = seconds;
    return this;
  }

  /** The `gh pr checks` command path. */
  protected override commandPath(): string[] {
    return ["pr", "checks", ...this.selectorArgs()];
  }

  /**
   * Assemble the `gh pr checks` flags, refusing the flags that only mean
   * something while watching — gh ignores them otherwise, which would leave a
   * build believing it had asked for something it had not.
   */
  protected override commandFlags(): string[] {
    if (!this.#watch && (this.#failFast || this.#interval !== undefined)) {
      throw new Error(
        "GhTasks.prChecks: .failFast()/.interval(...) describe how to watch, " +
          "which a single check run does not do — add .watch(), or drop them.",
      );
    }
    const argv: string[] = [];
    if (this.#watch) argv.push("--watch");
    if (this.#failFast) argv.push("--fail-fast");
    if (this.#required) argv.push("--required");
    if (this.#interval !== undefined) {
      argv.push("--interval", String(this.#interval));
    }
    argv.push(...this.readFlags());
    return argv;
  }
}

/** How `gh pr merge` combines the commits. */
export type GhMergeMethod = "merge" | "squash" | "rebase";

/** Settings for `gh pr merge`. */
export class GhPrMergeSettings extends GhPrTargetSettings {
  #method?: GhMergeMethod;
  #auto = false;
  #disableAuto = false;
  #admin = false;
  #deleteBranch = false;
  #subject?: string;
  #authorEmail?: string;
  #matchHeadCommit?: string;

  /** Merge with a merge commit (`--merge`). */
  merge(): this {
    this.#method = "merge";
    return this;
  }

  /** Squash the commits into one (`--squash`). */
  squash(): this {
    this.#method = "squash";
    return this;
  }

  /** Rebase the commits onto the base (`--rebase`). */
  rebase(): this {
    this.#method = "rebase";
    return this;
  }

  /** Merge once the requirements are met (`--auto`). */
  auto(): this {
    this.#auto = true;
    return this;
  }

  /** Turn auto-merge off again (`--disable-auto`). */
  disableAuto(): this {
    this.#disableAuto = true;
    return this;
  }

  /** Merge with administrator privileges (`--admin`). */
  admin(): this {
    this.#admin = true;
    return this;
  }

  /** Delete the branch afterwards (`--delete-branch`). */
  deleteBranch(): this {
    this.#deleteBranch = true;
    return this;
  }

  /** The merge commit's subject (`--subject`). */
  subject(text: string): this {
    this.#subject = text;
    return this;
  }

  /** The merge commit's author email (`--author-email`). */
  authorEmail(address: string): this {
    this.#authorEmail = address;
    return this;
  }

  /**
   * Refuse the merge unless the head is still this commit
   * (`--match-head-commit`) — the guard against merging a PR that moved
   * between the check and the merge.
   */
  matchHeadCommit(sha: string): this {
    this.#matchHeadCommit = sha;
    return this;
  }

  /** The `gh pr merge` command path. */
  protected override commandPath(): string[] {
    return ["pr", "merge", ...this.selectorArgs()];
  }

  /** Assemble the `gh pr merge` flags. */
  protected override commandFlags(): string[] {
    if (this.#auto && this.#disableAuto) {
      throw new Error(
        "GhTasks.prMerge: .auto() enables auto-merge and .disableAuto() turns " +
          "it off — pick one.",
      );
    }
    const argv: string[] = [];
    if (this.#method !== undefined) argv.push(`--${this.#method}`);
    if (this.#auto) argv.push("--auto");
    if (this.#disableAuto) argv.push("--disable-auto");
    if (this.#admin) argv.push("--admin");
    if (this.#deleteBranch) argv.push("--delete-branch");
    if (this.#subject !== undefined) argv.push("--subject", this.#subject);
    argv.push(...this.bodyFlags("prMerge"));
    if (this.#authorEmail !== undefined) {
      argv.push("--author-email", this.#authorEmail);
    }
    if (this.#matchHeadCommit !== undefined) {
      argv.push("--match-head-commit", this.#matchHeadCommit);
    }
    return argv;
  }
}

/** Settings for `gh pr comment`. */
export class GhPrCommentSettings extends GhPrTargetSettings {
  #editLast = false;
  #createIfNone = false;
  #deleteLast = false;
  #yes = false;

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

  /** The `gh pr comment` command path. */
  protected override commandPath(): string[] {
    return ["pr", "comment", ...this.selectorArgs()];
  }

  /** Assemble the `gh pr comment` flags. */
  protected override commandFlags(): string[] {
    if (this.#deleteLast && !this.#yes) {
      throw new Error(
        "GhTasks.prComment: .deleteLast() prompts for confirmation, which a " +
          "build cannot answer — add .yes() to mean it.",
      );
    }
    if (this.#createIfNone && !this.#editLast) {
      throw new Error(
        "GhTasks.prComment: .createIfNone() qualifies .editLast() — add it, " +
          "or drop .createIfNone().",
      );
    }
    const argv = [...this.bodyFlags("prComment")];
    if (this.#editLast) argv.push("--edit-last");
    if (this.#createIfNone) argv.push("--create-if-none");
    if (this.#deleteLast) argv.push("--delete-last");
    if (this.#yes) argv.push("--yes");
    return argv;
  }
}

/** Settings for `gh pr edit`. */
export class GhPrEditSettings extends GhPrTargetSettings {
  #title?: string;
  #base?: string;
  #addLabels: string[] = [];
  #removeLabels: string[] = [];
  #addAssignees: string[] = [];
  #removeAssignees: string[] = [];
  #addReviewers: string[] = [];
  #removeReviewers: string[] = [];
  #addProjects: string[] = [];
  #removeProjects: string[] = [];
  #milestone?: string;
  #removeMilestone = false;

  /** Set the title (`--title`). */
  title(text: string): this {
    this.#title = text;
    return this;
  }

  /** Change the base branch (`--base`). */
  base(branch: string): this {
    this.#base = branch;
    return this;
  }

  /** Add a label (`--add-label`); repeatable. */
  addLabel(...names: string[]): this {
    this.#addLabels.push(...names);
    return this;
  }

  /** Remove a label (`--remove-label`); repeatable. */
  removeLabel(...names: string[]): this {
    this.#removeLabels.push(...names);
    return this;
  }

  /** Add an assignee (`--add-assignee`); repeatable. */
  addAssignee(...logins: string[]): this {
    this.#addAssignees.push(...logins);
    return this;
  }

  /** Remove an assignee (`--remove-assignee`); repeatable. */
  removeAssignee(...logins: string[]): this {
    this.#removeAssignees.push(...logins);
    return this;
  }

  /** Request a review (`--add-reviewer`); repeatable. */
  addReviewer(...handles: string[]): this {
    this.#addReviewers.push(...handles);
    return this;
  }

  /** Drop a review request (`--remove-reviewer`); repeatable. */
  removeReviewer(...handles: string[]): this {
    this.#removeReviewers.push(...handles);
    return this;
  }

  /** Add to a project by title (`--add-project`); repeatable. */
  addProject(...titles: string[]): this {
    this.#addProjects.push(...titles);
    return this;
  }

  /** Take it off a project by title (`--remove-project`); repeatable. */
  removeProject(...titles: string[]): this {
    this.#removeProjects.push(...titles);
    return this;
  }

  /** Set the milestone (`--milestone`). */
  milestone(name: string): this {
    this.#milestone = name;
    return this;
  }

  /** Clear the milestone (`--remove-milestone`). */
  removeMilestone(): this {
    this.#removeMilestone = true;
    return this;
  }

  /** The `gh pr edit` command path. */
  protected override commandPath(): string[] {
    return ["pr", "edit", ...this.selectorArgs()];
  }

  /** Assemble the `gh pr edit` flags. */
  protected override commandFlags(): string[] {
    if (this.#milestone !== undefined && this.#removeMilestone) {
      throw new Error(
        "GhTasks.prEdit: .milestone(...) sets one and .removeMilestone() " +
          "clears it — pick one.",
      );
    }
    const argv: string[] = [];
    if (this.#title !== undefined) argv.push("--title", this.#title);
    argv.push(...this.bodyFlags("prEdit"));
    if (this.#base !== undefined) argv.push("--base", this.#base);
    for (const name of this.#addLabels) argv.push("--add-label", name);
    for (const name of this.#removeLabels) argv.push("--remove-label", name);
    for (const login of this.#addAssignees) argv.push("--add-assignee", login);
    for (const login of this.#removeAssignees) {
      argv.push("--remove-assignee", login);
    }
    for (const handle of this.#addReviewers) {
      argv.push("--add-reviewer", handle);
    }
    for (const handle of this.#removeReviewers) {
      argv.push("--remove-reviewer", handle);
    }
    for (const title of this.#addProjects) argv.push("--add-project", title);
    for (const title of this.#removeProjects) {
      argv.push("--remove-project", title);
    }
    if (this.#milestone !== undefined) {
      argv.push("--milestone", this.#milestone);
    }
    if (this.#removeMilestone) argv.push("--remove-milestone");
    return argv;
  }
}

/** Settings for `gh pr close`. */
export class GhPrCloseSettings extends GhCommandSettings {
  #selector?: string;
  #comment?: string;
  #deleteBranch = false;

  /** The pull request — number, URL, or branch; defaults to the current branch's. */
  selector(value: string | number): this {
    this.#selector = String(value);
    return this;
  }

  /** Leave a closing comment (`--comment`). */
  comment(text: string): this {
    this.#comment = text;
    return this;
  }

  /** Delete the branch afterwards (`--delete-branch`). */
  deleteBranch(): this {
    this.#deleteBranch = true;
    return this;
  }

  /** The `gh pr close` command path. */
  protected override commandPath(): string[] {
    return ["pr", "close", ...selectorOperand(this.#selector)];
  }

  /** Assemble the `gh pr close` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#comment !== undefined) argv.push("--comment", this.#comment);
    if (this.#deleteBranch) argv.push("--delete-branch");
    return argv;
  }
}

/** One pull request of {@link "./gh.ts".GhTasks.prListEntries}. */
export interface GhPullRequestEntry {
  /** The pull request's number. */
  number?: number;
  /** Its title. */
  title?: string;
  /** Its state, as gh reports it: `OPEN`, `CLOSED`, or `MERGED`. */
  state?: string;
  /** Whether it is still a draft. */
  isDraft?: boolean;
  /** The branch the changes are on. */
  headRefName?: string;
  /** The branch they would merge into. */
  baseRefName?: string;
  /** Its web URL. */
  url?: string;
  /** The login of whoever opened it. */
  author?: string;
}

/**
 * The `--json` fields {@link readPullRequests} asks for. gh requires the list
 * by name — there is no "everything" form — so the reader pins the set its
 * {@link GhPullRequestEntry} describes.
 */
export const PR_LIST_FIELDS: readonly string[] = [
  "number",
  "title",
  "state",
  "isDraft",
  "headRefName",
  "baseRefName",
  "url",
  "author",
];

/**
 * Parse `gh pr list --json …` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parsePullRequests(stdout: string): GhPullRequestEntry[] {
  return parseJsonArray(stdout).map((record) => {
    const entry: GhPullRequestEntry = {};
    const number = numberField(record, "number");
    const title = stringField(record, "title");
    const state = stringField(record, "state");
    const isDraft = booleanField(record, "isDraft");
    const head = stringField(record, "headRefName");
    const base = stringField(record, "baseRefName");
    const url = stringField(record, "url");
    const author = loginField(record, "author");
    if (number !== undefined) entry.number = number;
    if (title !== undefined) entry.title = title;
    if (state !== undefined) entry.state = state;
    if (isDraft !== undefined) entry.isDraft = isDraft;
    if (head !== undefined) entry.headRefName = head;
    if (base !== undefined) entry.baseRefName = base;
    if (url !== undefined) entry.url = url;
    if (author !== undefined) entry.author = author;
    return entry;
  });
}

/**
 * Run `gh pr list --json …` and parse it. Backs
 * {@link "./gh.ts".GhTasks.prListEntries}.
 */
export async function readPullRequests(
  configure?: Configure<GhPrListSettings>,
): Promise<GhPullRequestEntry[]> {
  const settings = new GhPrListSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.json(...PR_LIST_FIELDS).run();
  return parsePullRequests(output.stdout);
}
