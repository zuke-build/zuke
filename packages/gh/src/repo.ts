// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `gh repo` — the repository commands a build drives: clone, create, view,
 * list, fork, sync, edit, rename, archive, unarchive, delete, and
 * set-default.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * await GhTasks.repoClone((s) => s.repository("acme/app").directory("vendor/app"));
 * await GhTasks.repoSync((s) => s.source("upstream/app").branch("master"));
 * const mine = await GhTasks.repoListEntries((s) => s.owner("acme").noArchived());
 * ```
 *
 * The group has more subcommands than these — `gitignore`, `license`,
 * `read-file`, `read-dir`, `deploy-key`, `autolink` — which no build has a
 * reason to drive; {@link "./gh.ts".GhTasks.run} stays the builder for those.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import {
  GhCommandSettings,
  GhReadSettings,
  GhWebReadSettings,
} from "./subcommand.ts";
import { booleanField, parseJsonArray, stringField } from "./json_array.ts";

/** How visible a repository is (`--visibility`). */
export type GhRepoVisibility = "public" | "private" | "internal";

/**
 * Render a tri-state flag the way gh's own parser reads it: bare when it is
 * being turned on, and `--flag=false` when it is being turned off.
 */
function toggleArg(flag: string, enabled: boolean): string {
  return enabled ? `--${flag}` : `--${flag}=false`;
}

/**
 * Refuse a `--repo` flag on a command gh gives none.
 *
 * The `gh repo` group names its repository as a positional operand, and only
 * `rename` also takes `-R`. A `.repo(...)` inherited from
 * {@link "./settings.ts".GhSettings} would therefore render a flag gh rejects
 * as unknown, so every command here says so before gh is ever spawned. One
 * implementation, because the settings classes reach it from three different
 * bases.
 */
function refuseRepoFlag(
  task: string,
  operandHint: string,
  slug: string | undefined,
): void {
  if (slug !== undefined) {
    throw new Error(
      `GhTasks.${task}: gh gives this command no --repo flag — it names the ` +
        `repository as an operand, so use ${operandHint} instead of ` +
        ".repo(...).",
    );
  }
}

/**
 * Base for the `gh repo` commands that neither print JSON nor take `--repo`.
 * {@link GhRepoListSettings} and {@link GhRepoViewSettings} do print JSON, so
 * they extend the read bases and call {@link refuseRepoFlag} themselves.
 */
export abstract class GhRepoCommandSettings extends GhCommandSettings {
  /** The task name a refusal names, e.g. `repoClone`. */
  protected abstract readonly taskName: string;

  /** How this command names its repository, e.g. `.repository(...)`. */
  protected abstract readonly operandHint: string;

  /** This command's flags, after refusing a `--repo` it cannot render. */
  protected override middleTokens(): string[] {
    refuseRepoFlag(this.taskName, this.operandHint, this.repoSlug);
    return this.commandFlags();
  }
}

/** Settings for `gh repo clone`. */
export class GhRepoCloneSettings extends GhRepoCommandSettings {
  /** The task this settings class backs. */
  protected override readonly taskName = "repoClone";
  /** How this command names its repository. */
  protected override readonly operandHint = ".repository(...)";

  #repository?: string;
  #directory?: string;
  #upstreamRemoteName?: string;
  #noUpstream = false;
  #gitArgs: string[] = [];

  /** The repository, as `owner/name` or a URL (required). */
  repository(slug: string): this {
    this.#repository = slug;
    return this;
  }

  /** The directory to clone into; gh names it after the repository otherwise. */
  directory(path: PathLike): this {
    this.#directory = String(path);
    return this;
  }

  /** The remote name for a fork's parent (`--upstream-remote-name`). */
  upstreamRemoteName(name: string): this {
    this.#upstreamRemoteName = name;
    return this;
  }

  /** Do not add the upstream remote when cloning a fork (`--no-upstream`). */
  noUpstream(): this {
    this.#noUpstream = true;
    return this;
  }

  /**
   * Flags for the underlying `git clone`, which gh takes after a `--`
   * separator — `.gitArgs("--depth=1")` for a shallow clone.
   */
  gitArgs(...args: string[]): this {
    this.#gitArgs.push(...args);
    return this;
  }

  /** The `gh repo clone` command path, with the repository and directory. */
  protected override commandPath(): string[] {
    if (this.#repository === undefined) {
      throw new Error(
        "GhTasks.repoClone: .repository(...) is required — it names what to " +
          "clone.",
      );
    }
    const argv = ["repo", "clone", this.#repository];
    if (this.#directory !== undefined) argv.push(this.#directory);
    return argv;
  }

  /** Assemble the `gh repo clone` flags, with any git flags after `--`. */
  protected override commandFlags(): string[] {
    if (this.#noUpstream && this.#upstreamRemoteName !== undefined) {
      throw new Error(
        "GhTasks.repoClone: .noUpstream() adds no upstream remote, so " +
          ".upstreamRemoteName(...) would name nothing — drop one.",
      );
    }
    const argv: string[] = [];
    if (this.#upstreamRemoteName !== undefined) {
      argv.push("--upstream-remote-name", this.#upstreamRemoteName);
    }
    if (this.#noUpstream) argv.push("--no-upstream");
    if (this.#gitArgs.length > 0) argv.push("--", ...this.#gitArgs);
    return argv;
  }
}

/** Settings for `gh repo create`. */
export class GhRepoCreateSettings extends GhRepoCommandSettings {
  /** The task this settings class backs. */
  protected override readonly taskName = "repoCreate";
  /** How this command names its repository. */
  protected override readonly operandHint = ".name(...)";

  #name?: string;
  #visibility?: GhRepoVisibility;
  #description?: string;
  #homepage?: string;
  #team?: string;
  #template?: string;
  #gitignore?: string;
  #license?: string;
  #source?: string;
  #remote?: string;
  #clone = false;
  #push = false;
  #addReadme = false;
  #includeAllBranches = false;
  #disableIssues = false;
  #disableWiki = false;

  /** The repository's name, or `owner/name` to create it elsewhere (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** How visible it is: `--public`, `--private`, or `--internal` (required). */
  visibility(value: GhRepoVisibility): this {
    this.#visibility = value;
    return this;
  }

  /** Its description (`--description`). */
  description(text: string): this {
    this.#description = text;
    return this;
  }

  /** Its homepage (`--homepage`). */
  homepage(url: string): this {
    this.#homepage = url;
    return this;
  }

  /** Grant an organization team access (`--team`). */
  team(name: string): this {
    this.#team = name;
    return this;
  }

  /** Base it on a template repository (`--template`). */
  template(slug: string): this {
    this.#template = slug;
    return this;
  }

  /** Start from a gitignore template (`--gitignore`). */
  gitignore(name: string): this {
    this.#gitignore = name;
    return this;
  }

  /** Add an open-source license (`--license`). */
  license(name: string): this {
    this.#license = name;
    return this;
  }

  /** Create it from a local repository (`--source`). */
  source(path: PathLike): this {
    this.#source = String(path);
    return this;
  }

  /** The remote name for the new repository (`--remote`). */
  remote(name: string): this {
    this.#remote = name;
    return this;
  }

  /** Clone it after creating it (`--clone`). */
  clone(): this {
    this.#clone = true;
    return this;
  }

  /** Push the local commits to it (`--push`). */
  push(): this {
    this.#push = true;
    return this;
  }

  /** Add a README (`--add-readme`). */
  addReadme(): this {
    this.#addReadme = true;
    return this;
  }

  /** Copy every branch of the template, not just its default (`--include-all-branches`). */
  includeAllBranches(): this {
    this.#includeAllBranches = true;
    return this;
  }

  /** Turn issues off (`--disable-issues`). */
  disableIssues(): this {
    this.#disableIssues = true;
    return this;
  }

  /** Turn the wiki off (`--disable-wiki`). */
  disableWiki(): this {
    this.#disableWiki = true;
    return this;
  }

  /** The `gh repo create` command path. */
  protected override commandPath(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "GhTasks.repoCreate: .name(...) is required — without it gh prompts, " +
          "and a build has no one to answer.",
      );
    }
    return ["repo", "create", this.#name];
  }

  /** Assemble the `gh repo create` flags. */
  protected override commandFlags(): string[] {
    if (this.#visibility === undefined) {
      throw new Error(
        "GhTasks.repoCreate: .visibility(...) is required — gh will not " +
          "guess whether a new repository is public.",
      );
    }
    if (this.#source !== undefined && this.#addReadme) {
      throw new Error(
        "GhTasks.repoCreate: .addReadme() writes a new README, which " +
          ".source(...) would overwrite from the local repository — drop one.",
      );
    }
    if (this.#template !== undefined && this.#source !== undefined) {
      throw new Error(
        "GhTasks.repoCreate: .template(...) and .source(...) are two " +
          "starting points for the same repository — pick one.",
      );
    }
    if (this.#push && this.#source === undefined) {
      throw new Error(
        "GhTasks.repoCreate: .push() pushes the local commits, so it needs " +
          ".source(...) — add it, or drop .push().",
      );
    }
    const argv = [`--${this.#visibility}`];
    if (this.#description !== undefined) {
      argv.push("--description", this.#description);
    }
    if (this.#homepage !== undefined) argv.push("--homepage", this.#homepage);
    if (this.#team !== undefined) argv.push("--team", this.#team);
    if (this.#template !== undefined) argv.push("--template", this.#template);
    if (this.#includeAllBranches) argv.push("--include-all-branches");
    if (this.#gitignore !== undefined) {
      argv.push("--gitignore", this.#gitignore);
    }
    if (this.#license !== undefined) argv.push("--license", this.#license);
    if (this.#addReadme) argv.push("--add-readme");
    if (this.#disableIssues) argv.push("--disable-issues");
    if (this.#disableWiki) argv.push("--disable-wiki");
    if (this.#source !== undefined) argv.push("--source", this.#source);
    if (this.#remote !== undefined) argv.push("--remote", this.#remote);
    if (this.#push) argv.push("--push");
    if (this.#clone) argv.push("--clone");
    return argv;
  }
}

/** Settings for `gh repo list`. */
export class GhRepoListSettings extends GhReadSettings {
  #owner?: string;
  #language?: string;
  #topics: string[] = [];
  #visibility?: GhRepoVisibility;
  #archived = false;
  #noArchived = false;
  #fork = false;
  #source = false;
  #limit?: number;

  /** Whose repositories to list; gh lists your own when it is omitted. */
  owner(login: string): this {
    this.#owner = login;
    return this;
  }

  /** Filter by primary language (`--language`). */
  language(name: string): this {
    this.#language = name;
    return this;
  }

  /** Filter by topic (`--topic`); repeatable. */
  topic(...names: string[]): this {
    this.#topics.push(...names);
    return this;
  }

  /** Filter by visibility (`--visibility`). */
  visibility(value: GhRepoVisibility): this {
    this.#visibility = value;
    return this;
  }

  /** Only archived repositories (`--archived`). */
  archived(): this {
    this.#archived = true;
    return this;
  }

  /** Leave archived repositories out (`--no-archived`). */
  noArchived(): this {
    this.#noArchived = true;
    return this;
  }

  /** Only forks (`--fork`). */
  fork(): this {
    this.#fork = true;
    return this;
  }

  /** Only repositories that are not forks (`--source`). */
  source(): this {
    this.#source = true;
    return this;
  }

  /** Cap how many are fetched (`--limit`); gh's default is 30. */
  limit(count: number): this {
    this.#limit = count;
    return this;
  }

  /** The `gh repo list` command path, with the owner when one was given. */
  protected override commandPath(): string[] {
    const argv = ["repo", "list"];
    if (this.#owner !== undefined) argv.push(this.#owner);
    return argv;
  }

  /** This command's flags, after refusing a `--repo` gh would reject. */
  protected override middleTokens(): string[] {
    refuseRepoFlag("repoList", ".owner(...)", this.repoSlug);
    return this.commandFlags();
  }

  /** Assemble the `gh repo list` flags. */
  protected override commandFlags(): string[] {
    if (this.#archived && this.#noArchived) {
      throw new Error(
        "GhTasks.repoList: .archived() keeps only archived repositories and " +
          ".noArchived() drops them — pick one.",
      );
    }
    if (this.#fork && this.#source) {
      throw new Error(
        "GhTasks.repoList: .fork() keeps only forks and .source() only " +
          "non-forks — pick one.",
      );
    }
    const argv: string[] = [];
    if (this.#language !== undefined) argv.push("--language", this.#language);
    for (const name of this.#topics) argv.push("--topic", name);
    if (this.#visibility !== undefined) {
      argv.push("--visibility", this.#visibility);
    }
    if (this.#archived) argv.push("--archived");
    if (this.#noArchived) argv.push("--no-archived");
    if (this.#fork) argv.push("--fork");
    if (this.#source) argv.push("--source");
    if (this.#limit !== undefined) argv.push("--limit", String(this.#limit));
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh repo view`. */
export class GhRepoViewSettings extends GhWebReadSettings {
  #repository?: string;
  #branch?: string;

  /** The repository, as `owner/name`; gh uses the current one otherwise. */
  repository(slug: string): this {
    this.#repository = slug;
    return this;
  }

  /** View a particular branch (`--branch`). */
  branch(name: string): this {
    this.#branch = name;
    return this;
  }

  /** The `gh repo view` command path. */
  protected override commandPath(): string[] {
    const argv = ["repo", "view"];
    if (this.#repository !== undefined) argv.push(this.#repository);
    return argv;
  }

  /** This command's flags, after refusing a `--repo` gh would reject. */
  protected override middleTokens(): string[] {
    refuseRepoFlag("repoView", ".repository(...)", this.repoSlug);
    return this.commandFlags();
  }

  /** Assemble the `gh repo view` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#branch !== undefined) argv.push("--branch", this.#branch);
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh repo fork`. */
export class GhRepoForkSettings extends GhRepoCommandSettings {
  /** The task this settings class backs. */
  protected override readonly taskName = "repoFork";
  /** How this command names its repository. */
  protected override readonly operandHint = ".repository(...)";

  #repository?: string;
  #org?: string;
  #forkName?: string;
  #remoteName?: string;
  #clone = false;
  #remote = false;
  #defaultBranchOnly = false;
  #gitArgs: string[] = [];

  /** The repository to fork; gh forks the current one otherwise. */
  repository(slug: string): this {
    this.#repository = slug;
    return this;
  }

  /** Create the fork in an organization (`--org`). */
  org(name: string): this {
    this.#org = name;
    return this;
  }

  /** Name the fork something else (`--fork-name`). */
  forkName(value: string): this {
    this.#forkName = value;
    return this;
  }

  /** The remote name to add for the fork (`--remote-name`). */
  remoteName(value: string): this {
    this.#remoteName = value;
    return this;
  }

  /** Clone the fork after creating it (`--clone`). */
  clone(): this {
    this.#clone = true;
    return this;
  }

  /** Add a git remote for the fork (`--remote`). */
  remote(): this {
    this.#remote = true;
    return this;
  }

  /** Fork only the default branch (`--default-branch-only`). */
  defaultBranchOnly(): this {
    this.#defaultBranchOnly = true;
    return this;
  }

  /** Flags for the underlying `git clone`, passed after a `--` separator. */
  gitArgs(...args: string[]): this {
    this.#gitArgs.push(...args);
    return this;
  }

  /** The `gh repo fork` command path. */
  protected override commandPath(): string[] {
    const argv = ["repo", "fork"];
    if (this.#repository !== undefined) argv.push(this.#repository);
    return argv;
  }

  /** Assemble the `gh repo fork` flags, with any git flags after `--`. */
  protected override commandFlags(): string[] {
    if (this.#gitArgs.length > 0 && !this.#clone) {
      throw new Error(
        "GhTasks.repoFork: the git flags after `--` are for the clone, so " +
          "they need .clone() — add it, or drop .gitArgs(...).",
      );
    }
    const argv: string[] = [];
    if (this.#org !== undefined) argv.push("--org", this.#org);
    if (this.#forkName !== undefined) argv.push("--fork-name", this.#forkName);
    if (this.#defaultBranchOnly) argv.push("--default-branch-only");
    if (this.#remote) argv.push("--remote");
    if (this.#remoteName !== undefined) {
      argv.push("--remote-name", this.#remoteName);
    }
    if (this.#clone) argv.push("--clone");
    if (this.#gitArgs.length > 0) argv.push("--", ...this.#gitArgs);
    return argv;
  }
}

/** Settings for `gh repo sync`. */
export class GhRepoSyncSettings extends GhRepoCommandSettings {
  /** The task this settings class backs. */
  protected override readonly taskName = "repoSync";
  /** How this command names its repository. */
  protected override readonly operandHint = ".destination(...)";

  #destination?: string;
  #source?: string;
  #branch?: string;
  #force = false;

  /** The repository to update; gh syncs the local one otherwise. */
  destination(slug: string): this {
    this.#destination = slug;
    return this;
  }

  /** Where to sync from (`--source`); gh uses the fork's parent otherwise. */
  source(slug: string): this {
    this.#source = slug;
    return this;
  }

  /** The branch to sync (`--branch`); gh uses the default branch otherwise. */
  branch(name: string): this {
    this.#branch = name;
    return this;
  }

  /** Hard-reset the destination branch onto the source (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** The `gh repo sync` command path. */
  protected override commandPath(): string[] {
    const argv = ["repo", "sync"];
    if (this.#destination !== undefined) argv.push(this.#destination);
    return argv;
  }

  /** Assemble the `gh repo sync` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#source !== undefined) argv.push("--source", this.#source);
    if (this.#branch !== undefined) argv.push("--branch", this.#branch);
    if (this.#force) argv.push("--force");
    return argv;
  }
}

/** Settings for `gh repo edit`. */
export class GhRepoEditSettings extends GhRepoCommandSettings {
  /** The task this settings class backs. */
  protected override readonly taskName = "repoEdit";
  /** How this command names its repository. */
  protected override readonly operandHint = ".repository(...)";

  #repository?: string;
  #description?: string;
  #homepage?: string;
  #defaultBranch?: string;
  #visibility?: GhRepoVisibility;
  #acceptVisibilityChangeConsequences = false;
  #addTopics: string[] = [];
  #removeTopics: string[] = [];
  #toggles: Array<[string, boolean]> = [];

  /** The repository to edit; gh edits the current one otherwise. */
  repository(slug: string): this {
    this.#repository = slug;
    return this;
  }

  /** Set the description (`--description`). */
  description(text: string): this {
    this.#description = text;
    return this;
  }

  /** Set the homepage (`--homepage`). */
  homepage(url: string): this {
    this.#homepage = url;
    return this;
  }

  /** Set the default branch (`--default-branch`). */
  defaultBranch(name: string): this {
    this.#defaultBranch = name;
    return this;
  }

  /** Change the visibility (`--visibility`), which needs {@link acceptVisibilityChangeConsequences}. */
  visibility(value: GhRepoVisibility): this {
    this.#visibility = value;
    return this;
  }

  /** Acknowledge what a visibility change does (`--accept-visibility-change-consequences`). */
  acceptVisibilityChangeConsequences(): this {
    this.#acceptVisibilityChangeConsequences = true;
    return this;
  }

  /** Add a topic (`--add-topic`); repeatable. */
  addTopic(...names: string[]): this {
    this.#addTopics.push(...names);
    return this;
  }

  /** Remove a topic (`--remove-topic`); repeatable. */
  removeTopic(...names: string[]): this {
    this.#removeTopics.push(...names);
    return this;
  }

  /** Turn issues on or off (`--enable-issues`). */
  enableIssues(enabled = true): this {
    this.#toggles.push(["enable-issues", enabled]);
    return this;
  }

  /** Turn the wiki on or off (`--enable-wiki`). */
  enableWiki(enabled = true): this {
    this.#toggles.push(["enable-wiki", enabled]);
    return this;
  }

  /** Turn projects on or off (`--enable-projects`). */
  enableProjects(enabled = true): this {
    this.#toggles.push(["enable-projects", enabled]);
    return this;
  }

  /** Turn discussions on or off (`--enable-discussions`). */
  enableDiscussions(enabled = true): this {
    this.#toggles.push(["enable-discussions", enabled]);
    return this;
  }

  /** Turn auto-merge on or off (`--enable-auto-merge`). */
  enableAutoMerge(enabled = true): this {
    this.#toggles.push(["enable-auto-merge", enabled]);
    return this;
  }

  /** Allow or forbid merge commits (`--enable-merge-commit`). */
  enableMergeCommit(enabled = true): this {
    this.#toggles.push(["enable-merge-commit", enabled]);
    return this;
  }

  /** Allow or forbid squash merges (`--enable-squash-merge`). */
  enableSquashMerge(enabled = true): this {
    this.#toggles.push(["enable-squash-merge", enabled]);
    return this;
  }

  /** Allow or forbid rebase merges (`--enable-rebase-merge`). */
  enableRebaseMerge(enabled = true): this {
    this.#toggles.push(["enable-rebase-merge", enabled]);
    return this;
  }

  /** Delete the head branch after a merge, or stop (`--delete-branch-on-merge`). */
  deleteBranchOnMerge(enabled = true): this {
    this.#toggles.push(["delete-branch-on-merge", enabled]);
    return this;
  }

  /** Allow or forbid forking (`--allow-forking`). */
  allowForking(enabled = true): this {
    this.#toggles.push(["allow-forking", enabled]);
    return this;
  }

  /** Allow or forbid updating a pull request branch (`--allow-update-branch`). */
  allowUpdateBranch(enabled = true): this {
    this.#toggles.push(["allow-update-branch", enabled]);
    return this;
  }

  /** Turn secret scanning on or off (`--enable-secret-scanning`). */
  enableSecretScanning(enabled = true): this {
    this.#toggles.push(["enable-secret-scanning", enabled]);
    return this;
  }

  /** Turn push protection on or off (`--enable-secret-scanning-push-protection`). */
  enableSecretScanningPushProtection(enabled = true): this {
    this.#toggles.push([
      "enable-secret-scanning-push-protection",
      enabled,
    ]);
    return this;
  }

  /** The `gh repo edit` command path. */
  protected override commandPath(): string[] {
    const argv = ["repo", "edit"];
    if (this.#repository !== undefined) argv.push(this.#repository);
    return argv;
  }

  /** Assemble the `gh repo edit` flags. */
  protected override commandFlags(): string[] {
    if (
      this.#visibility !== undefined &&
      !this.#acceptVisibilityChangeConsequences
    ) {
      throw new Error(
        "GhTasks.repoEdit: gh confirms a visibility change before making it, " +
          "which a build cannot answer — add " +
          ".acceptVisibilityChangeConsequences() to mean it.",
      );
    }
    const argv: string[] = [];
    if (this.#description !== undefined) {
      argv.push("--description", this.#description);
    }
    if (this.#homepage !== undefined) argv.push("--homepage", this.#homepage);
    if (this.#defaultBranch !== undefined) {
      argv.push("--default-branch", this.#defaultBranch);
    }
    for (const name of this.#addTopics) argv.push("--add-topic", name);
    for (const name of this.#removeTopics) argv.push("--remove-topic", name);
    for (const [flag, enabled] of this.#toggles) {
      argv.push(toggleArg(flag, enabled));
    }
    if (this.#visibility !== undefined) {
      argv.push("--visibility", this.#visibility);
      argv.push("--accept-visibility-change-consequences");
    }
    return argv;
  }
}

/** Settings for `gh repo rename`. */
export class GhRepoRenameSettings extends GhCommandSettings {
  #newName?: string;
  #yes = false;

  /** The repository's new name, without the owner (required). */
  newName(value: string): this {
    this.#newName = value;
    return this;
  }

  /** Skip the confirmation a rename otherwise prompts for (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** The `gh repo rename` command path. */
  protected override commandPath(): string[] {
    if (this.#newName === undefined) {
      throw new Error(
        "GhTasks.repoRename: .newName(...) is required — use .repo(...) to " +
          "name the repository being renamed.",
      );
    }
    return ["repo", "rename", this.#newName];
  }

  /** Assemble the `gh repo rename` flags. */
  protected override commandFlags(): string[] {
    if (!this.#yes) {
      throw new Error(
        "GhTasks.repoRename: gh prompts before renaming, which a build " +
          "cannot answer — add .yes() to mean it.",
      );
    }
    return ["--yes"];
  }
}

/** Settings for `gh repo archive` and `gh repo unarchive`. */
export class GhRepoArchiveSettings extends GhRepoCommandSettings {
  /** The task this settings class backs. */
  protected override readonly taskName = "repoArchive";
  /** How this command names its repository. */
  protected override readonly operandHint = ".repository(...)";

  #repository?: string;
  #unarchive = false;
  #yes = false;

  /** The repository; gh acts on the current one otherwise. */
  repository(slug: string): this {
    this.#repository = slug;
    return this;
  }

  /** Restore an archived repository instead — `gh repo unarchive`. */
  unarchive(): this {
    this.#unarchive = true;
    return this;
  }

  /** Skip the confirmation gh otherwise prompts for (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** The `gh repo archive` or `gh repo unarchive` command path. */
  protected override commandPath(): string[] {
    const argv = ["repo", this.#unarchive ? "unarchive" : "archive"];
    if (this.#repository !== undefined) argv.push(this.#repository);
    return argv;
  }

  /** Assemble the flags. */
  protected override commandFlags(): string[] {
    if (!this.#yes) {
      throw new Error(
        "GhTasks.repoArchive: gh prompts before archiving, which a build " +
          "cannot answer — add .yes() to mean it.",
      );
    }
    return ["--yes"];
  }
}

/** Settings for `gh repo delete`. */
export class GhRepoDeleteSettings extends GhRepoCommandSettings {
  /** The task this settings class backs. */
  protected override readonly taskName = "repoDelete";
  /** How this command names its repository. */
  protected override readonly operandHint = ".repository(...)";

  #repository?: string;
  #yes = false;

  /** The repository to delete, as `owner/name` (required — see below). */
  repository(slug: string): this {
    this.#repository = slug;
    return this;
  }

  /** Skip the confirmation a delete otherwise prompts for (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** The `gh repo delete` command path. */
  protected override commandPath(): string[] {
    if (this.#repository === undefined) {
      throw new Error(
        "GhTasks.repoDelete: .repository(...) is required — gh ignores --yes " +
          "when deleting the repository you are standing in and always asks, " +
          "so a build has to name what it is deleting.",
      );
    }
    return ["repo", "delete", this.#repository];
  }

  /** Assemble the `gh repo delete` flags. */
  protected override commandFlags(): string[] {
    if (!this.#yes) {
      throw new Error(
        "GhTasks.repoDelete: gh prompts before deleting, which a build " +
          "cannot answer — add .yes() to mean it.",
      );
    }
    return ["--yes"];
  }
}

/** Settings for `gh repo set-default`. */
export class GhRepoSetDefaultSettings extends GhRepoCommandSettings {
  /** The task this settings class backs. */
  protected override readonly taskName = "repoSetDefault";
  /** How this command names its repository. */
  protected override readonly operandHint = ".repository(...)";

  #repository?: string;
  #unset = false;
  #view = false;

  /** The repository to make the default, as `owner/name` or a remote name. */
  repository(slugOrRemote: string): this {
    this.#repository = slugOrRemote;
    return this;
  }

  /** Forget the current default instead (`--unset`). */
  unset(): this {
    this.#unset = true;
    return this;
  }

  /** Report the current default instead (`--view`). */
  view(): this {
    this.#view = true;
    return this;
  }

  /** The `gh repo set-default` command path. */
  protected override commandPath(): string[] {
    const argv = ["repo", "set-default"];
    if (this.#repository !== undefined) argv.push(this.#repository);
    return argv;
  }

  /** Assemble the `gh repo set-default` flags. */
  protected override commandFlags(): string[] {
    if (this.#unset && this.#view) {
      throw new Error(
        "GhTasks.repoSetDefault: .unset() forgets the default and .view() " +
          "reports it — pick one.",
      );
    }
    if (this.#repository === undefined && !this.#unset && !this.#view) {
      throw new Error(
        "GhTasks.repoSetDefault: name the repository with .repository(...), " +
          "or ask for .view()/.unset() — without one gh shows a picker, and " +
          "a build has no one to answer it.",
      );
    }
    if (this.#repository !== undefined && (this.#unset || this.#view)) {
      throw new Error(
        "GhTasks.repoSetDefault: .repository(...) sets the default, which " +
          ".unset()/.view() do not — drop one.",
      );
    }
    const argv: string[] = [];
    if (this.#unset) argv.push("--unset");
    if (this.#view) argv.push("--view");
    return argv;
  }
}

/** One repository of {@link "./gh.ts".GhTasks.repoListEntries}. */
export interface GhRepositoryEntry {
  /** The repository's name, without the owner. */
  name?: string;
  /** Its full `owner/name`. */
  nameWithOwner?: string;
  /** Its description. */
  description?: string;
  /** Whether it is private. */
  isPrivate?: boolean;
  /** Whether it is a fork. */
  isFork?: boolean;
  /** Whether it is archived. */
  isArchived?: boolean;
  /** Its web URL. */
  url?: string;
  /** When it was last updated, ISO 8601. */
  updatedAt?: string;
}

/**
 * The `--json` fields {@link readRepositories} asks for; gh requires the list
 * by name, so the reader pins the set {@link GhRepositoryEntry} describes.
 */
export const REPO_LIST_FIELDS: readonly string[] = [
  "name",
  "nameWithOwner",
  "description",
  "isPrivate",
  "isFork",
  "isArchived",
  "url",
  "updatedAt",
];

/**
 * Parse `gh repo list --json …` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseRepositories(stdout: string): GhRepositoryEntry[] {
  return parseJsonArray(stdout).map((record) => {
    const entry: GhRepositoryEntry = {};
    const name = stringField(record, "name");
    const nameWithOwner = stringField(record, "nameWithOwner");
    const description = stringField(record, "description");
    const isPrivate = booleanField(record, "isPrivate");
    const isFork = booleanField(record, "isFork");
    const isArchived = booleanField(record, "isArchived");
    const url = stringField(record, "url");
    const updatedAt = stringField(record, "updatedAt");
    if (name !== undefined) entry.name = name;
    if (nameWithOwner !== undefined) entry.nameWithOwner = nameWithOwner;
    if (description !== undefined) entry.description = description;
    if (isPrivate !== undefined) entry.isPrivate = isPrivate;
    if (isFork !== undefined) entry.isFork = isFork;
    if (isArchived !== undefined) entry.isArchived = isArchived;
    if (url !== undefined) entry.url = url;
    if (updatedAt !== undefined) entry.updatedAt = updatedAt;
    return entry;
  });
}

/**
 * Run `gh repo list --json …` and parse it. Backs
 * {@link "./gh.ts".GhTasks.repoListEntries}.
 */
export async function readRepositories(
  configure?: Configure<GhRepoListSettings>,
): Promise<GhRepositoryEntry[]> {
  const settings = new GhRepoListSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.json(...REPO_LIST_FIELDS).run();
  return parseRepositories(output.stdout);
}
