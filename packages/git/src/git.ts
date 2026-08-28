// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `GitTasks` — typed task functions for the `git` commands, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.add((s) => s.all());
 * await GitTasks.commit((s) => s.message("ci: release"));
 * await GitTasks.push((s) => s.setUpstream().remote("origin").ref("main"));
 * const changed = await GitTasks.diffNames((s) => s.mergeBase("origin/main"));
 * ```
 *
 * Every command shares the global options `.dir()` (`-C <path>`) and
 * `.config()` (`-c key=value`). Most tasks resolve to the raw
 * {@link "@zuke/core/shell".CommandOutput}; the handful that end in a plural
 * noun (`statusEntries`, `logEntries`, `diffNames`, `remoteList`,
 * `worktreeList`, `lsFileNames`) run a machine-readable form and hand back
 * parsed values instead, so a target reads them rather than scraping stdout.
 * For anything without a typed task, use {@link GitTasksApi.run} with
 * `.command(...)`. Arguments stay a discrete argv array end-to-end — never a
 * concatenated shell string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { GitSettings } from "./settings.ts";
import { GitCloneSettings, GitInitSettings } from "./repository.ts";
import {
  GitAddSettings,
  GitCleanSettings,
  GitMvSettings,
  GitRestoreSettings,
  GitRmSettings,
} from "./staging.ts";
import { GitCommitSettings } from "./commit.ts";
import {
  type GitStatusEntry,
  GitStatusSettings,
  readStatusEntries,
} from "./status.ts";
import {
  GitBranchSettings,
  GitCheckoutSettings,
  GitSwitchSettings,
} from "./branch.ts";
import { GitTagSettings } from "./tag.ts";
import {
  GitFetchSettings,
  GitPullSettings,
  GitPushSettings,
} from "./transfer.ts";
import {
  GitLsRemoteSettings,
  type GitRemote,
  GitRemoteSettings,
  listRemotes,
} from "./remote.ts";
import {
  type GitCommitEntry,
  GitLogSettings,
  GitShowSettings,
  readLogEntries,
} from "./log.ts";
import { GitDiffSettings, readDiffNames } from "./diff.ts";
import { GitLsFilesSettings, readLsFileNames } from "./ls_files.ts";
import {
  GitDescribeSettings,
  GitRevParseSettings,
  readRevision,
} from "./revision.ts";
import { GitMergeSettings, GitRebaseSettings } from "./merge.ts";
import { GitCherryPickSettings, GitRevertSettings } from "./replay.ts";
import { GitResetSettings } from "./reset.ts";
import { GitStashSettings } from "./stash.ts";
import { GitConfigSettings, readConfigValue } from "./config.ts";
import { GitSubmoduleSettings } from "./submodule.ts";
import { GitArchiveSettings } from "./archive.ts";
import { GitApplySettings } from "./apply.ts";
import {
  type GitWorktree,
  GitWorktreeSettings,
  parseWorktreeList,
} from "./worktree.ts";
import {
  type GitDefaultBranchSettings,
  resolveDefaultBranch,
} from "./default_branch.ts";

/** Settings for an arbitrary `git` command not covered by a typed task. */
export class GitRunSettings extends GitSettings {
  #command: string[] = [];

  /** The subcommand and its arguments, e.g. `command("bisect", "start")`. */
  command(...parts: Array<string | number>): this {
    this.#command.push(...parts.map(String));
    return this;
  }

  /** Assemble the arbitrary `git` subcommand argv from `.command(...)`. */
  protected override subcommandArgs(): string[] {
    return [...this.#command];
  }
}

/** The shape of {@link GitTasks}. */
export interface GitTasksApi {
  /** Create a repository: `git init`. */
  init(configure?: Configure<GitInitSettings>): Promise<CommandOutput>;
  /** Clone a repository: `git clone`. */
  clone(configure?: Configure<GitCloneSettings>): Promise<CommandOutput>;
  /** Stage changes: `git add`. */
  add(configure?: Configure<GitAddSettings>): Promise<CommandOutput>;
  /** Remove tracked files: `git rm`. */
  rm(configure?: Configure<GitRmSettings>): Promise<CommandOutput>;
  /** Move or rename a tracked file: `git mv`. */
  mv(configure?: Configure<GitMvSettings>): Promise<CommandOutput>;
  /** Restore working-tree or index contents: `git restore`. */
  restore(configure?: Configure<GitRestoreSettings>): Promise<CommandOutput>;
  /** Delete untracked files: `git clean`. */
  clean(configure?: Configure<GitCleanSettings>): Promise<CommandOutput>;
  /** Record changes: `git commit`. */
  commit(configure?: Configure<GitCommitSettings>): Promise<CommandOutput>;
  /** Show working-tree status: `git status`. */
  status(configure?: Configure<GitStatusSettings>): Promise<CommandOutput>;
  /**
   * The working tree's changes as parsed {@link GitStatusEntry} values, from
   * `git status --porcelain -z` — the form no path can corrupt. An empty array
   * means a clean tree.
   *
   * The lambda configures the rest (`.dir()`, `.untrackedFiles()`, `.paths()`);
   * the output format is fixed, since the parse depends on it.
   */
  statusEntries(
    configure?: Configure<GitStatusSettings>,
  ): Promise<GitStatusEntry[]>;
  /** Switch branches or restore files: `git checkout`. */
  checkout(configure?: Configure<GitCheckoutSettings>): Promise<CommandOutput>;
  /** Switch branches: `git switch`, `checkout`'s modern half. */
  switch(configure?: Configure<GitSwitchSettings>): Promise<CommandOutput>;
  /** Manage branches: `git branch`. */
  branch(configure?: Configure<GitBranchSettings>): Promise<CommandOutput>;
  /** Manage tags: `git tag`. */
  tag(configure?: Configure<GitTagSettings>): Promise<CommandOutput>;
  /** Update remote refs: `git push`. */
  push(configure?: Configure<GitPushSettings>): Promise<CommandOutput>;
  /** Fetch and integrate: `git pull`. */
  pull(configure?: Configure<GitPullSettings>): Promise<CommandOutput>;
  /** Download objects and refs: `git fetch`. */
  fetch(configure?: Configure<GitFetchSettings>): Promise<CommandOutput>;
  /** Manage remotes: `git remote add|remove|rename|set-url|get-url|show|prune`. */
  remote(configure?: Configure<GitRemoteSettings>): Promise<CommandOutput>;
  /**
   * The configured remotes as parsed {@link GitRemote} entries, each with the
   * fetch and push URL folded together, from `git remote --verbose`.
   */
  remoteList(configure?: Configure<GitRemoteSettings>): Promise<GitRemote[]>;
  /** List a remote's refs without fetching them: `git ls-remote`. */
  lsRemote(configure?: Configure<GitLsRemoteSettings>): Promise<CommandOutput>;
  /** Show history: `git log`. */
  log(configure?: Configure<GitLogSettings>): Promise<CommandOutput>;
  /**
   * History as parsed {@link GitCommitEntry} values — SHA, parents, author,
   * dates, subject, and body — for building a changelog or deciding what a
   * range contains.
   *
   * The lambda configures the walk (`.range()`, `.maxCount()`, `.paths()`);
   * the `--format` is fixed, since the parse depends on it.
   */
  logEntries(configure?: Configure<GitLogSettings>): Promise<GitCommitEntry[]>;
  /** Show an object: `git show`. */
  show(configure?: Configure<GitShowSettings>): Promise<CommandOutput>;
  /** Show changes: `git diff`. */
  diff(configure?: Configure<GitDiffSettings>): Promise<CommandOutput>;
  /**
   * The changed paths of a diff, from `git diff --name-only -z`. What a target
   * needs to decide whether the work it guards has to run at all.
   */
  diffNames(configure?: Configure<GitDiffSettings>): Promise<string[]>;
  /** List index and working-tree files: `git ls-files`. */
  lsFiles(configure?: Configure<GitLsFilesSettings>): Promise<CommandOutput>;
  /**
   * The paths of a `git ls-files -z` listing — git's own file list, ignore
   * rules already applied.
   */
  lsFileNames(configure?: Configure<GitLsFilesSettings>): Promise<string[]>;
  /** Resolve revisions and repository paths: `git rev-parse`. */
  revParse(configure?: Configure<GitRevParseSettings>): Promise<CommandOutput>;
  /**
   * A `git rev-parse` result as a trimmed string — the commit SHA, ref name,
   * or path a version stamp or cache key is built from.
   */
  revision(configure?: Configure<GitRevParseSettings>): Promise<string>;
  /** Name a commit after the nearest tag: `git describe`. */
  describe(configure?: Configure<GitDescribeSettings>): Promise<CommandOutput>;
  /** Join two histories: `git merge`. */
  merge(configure?: Configure<GitMergeSettings>): Promise<CommandOutput>;
  /** Replay commits onto another base: `git rebase`. */
  rebase(configure?: Configure<GitRebaseSettings>): Promise<CommandOutput>;
  /** Apply existing commits here: `git cherry-pick`. */
  cherryPick(
    configure?: Configure<GitCherryPickSettings>,
  ): Promise<CommandOutput>;
  /** Undo commits with new ones: `git revert`. */
  revert(configure?: Configure<GitRevertSettings>): Promise<CommandOutput>;
  /** Move the branch, index, and optionally the working tree: `git reset`. */
  reset(configure?: Configure<GitResetSettings>): Promise<CommandOutput>;
  /** Park and restore uncommitted work: `git stash`. */
  stash(configure?: Configure<GitStashSettings>): Promise<CommandOutput>;
  /** Read or write configuration: `git config`. */
  config(configure?: Configure<GitConfigSettings>): Promise<CommandOutput>;
  /**
   * One configuration value, or `undefined` when the key is unset — which
   * `git config --get` reports as a non-zero exit rather than as empty output.
   * The lambda must pick the key with `.get(...)` or `.getAll(...)`.
   */
  configGet(
    configure?: Configure<GitConfigSettings>,
  ): Promise<string | undefined>;
  /** Manage submodules: `git submodule add|init|update|sync|status|foreach`. */
  submodule(
    configure?: Configure<GitSubmoduleSettings>,
  ): Promise<CommandOutput>;
  /** Package a tree as a tarball or zip: `git archive`. */
  archive(configure?: Configure<GitArchiveSettings>): Promise<CommandOutput>;
  /** Apply a patch file: `git apply`. */
  apply(configure?: Configure<GitApplySettings>): Promise<CommandOutput>;
  /**
   * Manage worktrees: `git worktree add|list|remove|prune`. Pick the
   * subcommand in the lambda — `s.add(path)`, `s.list()`, `s.remove(path)`, or
   * `s.prune()`. For a listing to read rather than print, use
   * {@link GitTasksApi.worktreeList}.
   */
  worktree(configure?: Configure<GitWorktreeSettings>): Promise<CommandOutput>;
  /**
   * List the repository's worktrees as parsed {@link GitWorktree} entries,
   * from `git worktree list --porcelain`.
   *
   * The lambda configures the global options (`.dir()`, `.config()`); the
   * subcommand itself is fixed, since the parse depends on it.
   */
  worktreeList(
    configure?: Configure<GitWorktreeSettings>,
  ): Promise<GitWorktree[]>;
  /**
   * The name of a remote's default branch — `main`, `master`, or whatever it
   * chose — so a build does not have to hardcode one.
   *
   * Reads the local `refs/remotes/<remote>/HEAD` first, which costs no network,
   * and asks the remote itself when that ref was never populated. Fails when
   * neither names a branch, rather than guessing.
   */
  defaultBranch(
    configure?: Configure<GitDefaultBranchSettings>,
  ): Promise<string>;
  /** Run any other git command via `.command(...)`. */
  run(configure?: Configure<GitRunSettings>): Promise<CommandOutput>;
}

/**
 * Run `git worktree list --porcelain` and parse it. Backs
 * {@link GitTasksApi.worktreeList}.
 */
async function listWorktrees(
  configure?: Configure<GitWorktreeSettings>,
): Promise<GitWorktree[]> {
  const settings = new GitWorktreeSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.list().porcelain().run();
  return parseWorktreeList(output.stdout);
}

/** Typed task functions for the `git` commands. */
export const GitTasks: GitTasksApi = {
  init: (c) => runSettings(new GitInitSettings(), c),
  clone: (c) => runSettings(new GitCloneSettings(), c),
  add: (c) => runSettings(new GitAddSettings(), c),
  rm: (c) => runSettings(new GitRmSettings(), c),
  mv: (c) => runSettings(new GitMvSettings(), c),
  restore: (c) => runSettings(new GitRestoreSettings(), c),
  clean: (c) => runSettings(new GitCleanSettings(), c),
  commit: (c) => runSettings(new GitCommitSettings(), c),
  status: (c) => runSettings(new GitStatusSettings(), c),
  statusEntries: (c) => readStatusEntries(c),
  checkout: (c) => runSettings(new GitCheckoutSettings(), c),
  switch: (c) => runSettings(new GitSwitchSettings(), c),
  branch: (c) => runSettings(new GitBranchSettings(), c),
  tag: (c) => runSettings(new GitTagSettings(), c),
  push: (c) => runSettings(new GitPushSettings(), c),
  pull: (c) => runSettings(new GitPullSettings(), c),
  fetch: (c) => runSettings(new GitFetchSettings(), c),
  remote: (c) => runSettings(new GitRemoteSettings(), c),
  remoteList: (c) => listRemotes(c),
  lsRemote: (c) => runSettings(new GitLsRemoteSettings(), c),
  log: (c) => runSettings(new GitLogSettings(), c),
  logEntries: (c) => readLogEntries(c),
  show: (c) => runSettings(new GitShowSettings(), c),
  diff: (c) => runSettings(new GitDiffSettings(), c),
  diffNames: (c) => readDiffNames(c),
  lsFiles: (c) => runSettings(new GitLsFilesSettings(), c),
  lsFileNames: (c) => readLsFileNames(c),
  revParse: (c) => runSettings(new GitRevParseSettings(), c),
  revision: (c) => readRevision(c),
  describe: (c) => runSettings(new GitDescribeSettings(), c),
  merge: (c) => runSettings(new GitMergeSettings(), c),
  rebase: (c) => runSettings(new GitRebaseSettings(), c),
  cherryPick: (c) => runSettings(new GitCherryPickSettings(), c),
  revert: (c) => runSettings(new GitRevertSettings(), c),
  reset: (c) => runSettings(new GitResetSettings(), c),
  stash: (c) => runSettings(new GitStashSettings(), c),
  config: (c) => runSettings(new GitConfigSettings(), c),
  configGet: (c) => readConfigValue(c),
  submodule: (c) => runSettings(new GitSubmoduleSettings(), c),
  archive: (c) => runSettings(new GitArchiveSettings(), c),
  apply: (c) => runSettings(new GitApplySettings(), c),
  worktree: (c) => runSettings(new GitWorktreeSettings(), c),
  worktreeList: (c) => listWorktrees(c),
  defaultBranch: (c) => resolveDefaultBranch(c),
  run: (c) => runSettings(new GitRunSettings(), c),
};
