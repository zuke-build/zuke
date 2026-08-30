import {
  CommandOutput,
  Configure,
  type PathLike,
  ToolSettings,
  type Normalize,
  type MaybePromise,
  type Command,
} from "@zuke/core";
import {
  BranchSettings,
  type GitSettings,
  gitSettings,
} from "./shared.ts";
import { type GitCommitSettings, readCommitHash } from "./commit.ts";
import {
  type GitLogSettings,
  readCommitList,
  readCommitListEntries,
} from "./log.ts";
import {
  GitCheckoutSettings,
  GitRestoreSettings,
  GitSwitchSettings,
} from "./checkout.ts";
import { GitAddSettings } from "./add.ts";
import { GitBranchSettings } from "./branch.ts";
import { GitCloneSettings } from "./clone.ts";
import { GitConfigSettings } from "./config.ts";
import { GitDiffSettings } from "./diff.ts";
import { GitFetchSettings } from "./fetch.ts";
import { GitInitSettings } from "./init.ts";
import { GitLsRemoteSettings } from "./ls_remote.ts";
import { GitMergeSettings } from "./merge.ts";
import { GitMvSettings } from "./mv.ts";
import { GitPullSettings } from "./pull.ts";
import { GitPushSettings } from "./push.ts";
import { GitRebaseSettings } from "./rebase.ts";
import {
  GitRemoteSettings,
  readRemoteList,
  readRemoteName,
} from "./remote.ts";
import { GitResetSettings } from "./reset.ts";
import { GitRmSettings } from "./rm.ts";
import { GitShowSettings, readShowCommit } from "./show.ts";
import {
  GitStashSettings,
  readStashEntries,
  readStashStatus,
} from "./stash.ts";
import { GitSubmoduleSettings } from "./submodule.ts";
import { GitTagSettings } from "./tag.ts";
import { GitStatusSettings, readStatus } from "./status.ts";
import { GitArchiveSettings } from "./archive.ts";
import { GitCherryPickSettings } from "./cherry_pick.ts";
import { GitCleanSettings } from "./clean.ts";
import { GitCommitSettings } from "./commit.ts";
import { GitDescribeSettings } from "./describe.ts";
import { GitHelpSettings } from "./help.ts";
import { GitLsFilesSettings, readLsFiles } from "./ls_files.ts";
import {
  GitRevParseSettings,
  readRevParse,
  readRevParseList,
} from "./rev_parse.ts";
import {
  GitDefaultBranchSettings,
  resolveDefaultBranch,
} from "./default_branch.ts";
import {
  type GitMergeBaseSettings,
  readIsAncestor,
  readMergeBase,
} from "./merge_base.ts";
import { GitRevListSettings, readCommitCount } from "./rev_list.ts";
import {
  GitForEachRefSettings,
  GitNameRevSettings,
  type GitRef,
  GitShowRefSettings,
  GitSymbolicRefSettings,
  readRefs,
} from "./for_each_ref.ts";
import {
  GitCatFileSettings,
  GitLsTreeSettings,
  type GitTreeEntry,
  readBlobText,
  readTreeEntries,
} from "./tree.ts";
import { GitCheckIgnoreSettings, readIsIgnored } from "./attributes.ts";
import {
  type GitBlameLine,
  GitBlameSettings,
  readBlameLines,
} from "./blame.ts";
import {
  type GitShortlogEntry,
  GitShortlogSettings,
  readShortlogEntries,
} from "./shortlog.ts";
import { GitGrepSettings } from "./grep.ts";
import {
  GitVerifyCommitSettings,
  GitVerifyTagSettings,
  readIsSignatureValid,
  readIsTagSignatureValid,
} from "./signatures.ts";
import { GitMergeTreeSettings, readMergesCleanly } from "./merge_tree.ts";

/** Settings for an arbitrary `git` command not covered by a typed task. */
export class GitRunSettings extends GitSettings {
  protected subcommand = "run";
}

/** API for git tasks exposed through `GitTasks`. */
export interface GitTasksApi {
  add(configure?: Configure<GitAddSettings>): Promise<CommandOutput>;
  archive(configure?: Configure<GitArchiveSettings>): Promise<CommandOutput>;
  blame(configure?: Configure<GitBlameSettings>): Promise<CommandOutput>;
  blameLines(configure?: Configure<GitBlameSettings>): Promise<GitBlameLine[]>;
  branch(configure?: Configure<GitBranchSettings>): Promise<CommandOutput>;
  catFile(configure?: Configure<GitCatFileSettings>): Promise<CommandOutput>;
  checkIgnore(configure?: Configure<GitCheckIgnoreSettings>): Promise<CommandOutput>;
  cherryPick(configure?: Configure<GitCherryPickSettings>): Promise<CommandOutput>;
  clean(configure?: Configure<GitCleanSettings>): Promise<CommandOutput>;
  clone(configure?: Configure<GitCloneSettings>): Promise<CommandOutput>;
  commit(configure?: Configure<GitCommitSettings>): Promise<CommandOutput>;
  commitCount(configure?: Configure<GitRevListSettings>): Promise<number>;
  config(configure?: Configure<GitConfigSettings>): Promise<CommandOutput>;
  configGet(configure?: Configure<GitConfigSettings>): Promise<string>;
  describe(configure?: Configure<GitDescribeSettings>): Promise<CommandOutput>;
  diff(configure?: Configure<GitDiffSettings>): Promise<CommandOutput>;
  forEachRef(configure?: Configure<GitForEachRefSettings>): Promise<CommandOutput>;
  fetch(configure?: Configure<GitFetchSettings>): Promise<CommandOutput>;
  grep(configure?: Configure<GitGrepSettings>): Promise<CommandOutput>;
  help(configure?: Configure<GitHelpSettings>): Promise<CommandOutput>;
  isAncestor(configure?: Configure<GitMergeBaseSettings>): Promise<boolean>;
  isIgnored(configure?: Configure<GitCheckIgnoreSettings>): Promise<boolean>;
  isSignatureValid(configure?: Configure<GitVerifyCommitSettings>): Promise<boolean>;
  isTagSignatureValid(configure?: Configure<GitVerifyTagSettings>): Promise<boolean>;
  lsFiles(configure?: Configure<GitLsFilesSettings>): Promise<CommandOutput>;
  lsRemote(configure?: Configure<GitLsRemoteSettings>): Promise<CommandOutput>;
  lsTree(configure?: Configure<GitLsTreeSettings>): Promise<CommandOutput>;
  log(configure?: Configure<GitLogSettings>): Promise<CommandOutput>;
  merge(configure?: Configure<GitMergeSettings>): Promise<CommandOutput>;
  mergeBase(configure?: Configure<GitMergeBaseSettings>): Promise<string>;
  mergeTree(configure?: Configure<GitMergeTreeSettings>): Promise<CommandOutput>;
  mergesCleanly(configure?: Configure<GitMergeTreeSettings>): Promise<boolean>;
  nameRev(configure?: Configure<GitNameRevSettings>): Promise<CommandOutput>;
  pull(configure?: Configure<GitPullSettings>): Promise<CommandOutput>;
  push(configure?: Configure<GitPushSettings>): Promise<CommandOutput>;
  rebase(configure?: Configure<GitRebaseSettings>): Promise<CommandOutput>;
  refs(configure?: Configure<GitForEachRefSettings>): Promise<GitRef[]>;
  remote(configure?: Configure<GitRemoteSettings>): Promise<CommandOutput>;
  revList(configure?: Configure<GitRevListSettings>): Promise<CommandOutput>;
  reset(configure?: Configure<GitResetSettings>): Promise<CommandOutput>;
  restore(configure?: Configure<GitRestoreSettings>): Promise<CommandOutput>;
  rm(configure?: Configure<GitRmSettings>): Promise<CommandOutput>;
  run(configure?: Configure<GitRunSettings>): Promise<CommandOutput>;
  show(configure?: Configure<GitShowSettings>): Promise<CommandOutput>;
  showRef(configure?: Configure<GitShowRefSettings>): Promise<CommandOutput>;
  shortlog(configure?: Configure<GitShortlogSettings>): Promise<CommandOutput>;
  shortlogEntries(configure?: Configure<GitShortlogSettings>): Promise<GitShortlogEntry[]>;
  stash(configure?: Configure<GitStashSettings>): Promise<CommandOutput>;
  status(configure?: Configure<GitStatusSettings>): Promise<CommandOutput>;
  submodule(configure?: Configure<GitSubmoduleSettings>): Promise<CommandOutput>;
  switch(configure?: Configure<GitSwitchSettings>): Promise<CommandOutput>;
  symbolicRef(configure?: Configure<GitSymbolicRefSettings>): Promise<CommandOutput>;
  tag(configure?: Configure<GitTagSettings>): Promise<CommandOutput>;
  treeEntries(configure?: Configure<GitLsTreeSettings>): Promise<GitTreeEntry[]>;
  verifyCommit(configure?: Configure<GitVerifyCommitSettings>): Promise<CommandOutput>;
  verifyTag(configure?: Configure<GitVerifyTagSettings>): Promise<CommandOutput>;
  worktreeList(configure?: Configure<GitWorktreeSettings>): Promise<CommandOutput>;
}

export const GitTasks: GitTasksApi = {
  add: (c) => runSettings(new GitAddSettings(), c),
  archive: (c) => runSettings(new GitArchiveSettings(), c),
  blame: (c) => runSettings(new GitBlameSettings(), c),
  blameLines: (c) => readBlameLines(c),
  branch: (c) => runSettings(new GitBranchSettings(), c),
  catFile: (c) => runSettings(new GitCatFileSettings(), c),
  checkIgnore: (c) => runSettings(new GitCheckIgnoreSettings(), c),
  cherryPick: (c) => runSettings(new GitCherryPickSettings(), c),
  clean: (c) => runSettings(new GitCleanSettings(), c),
  clone: (c) => runSettings(new GitCloneSettings(), c),
  commit: (c) => runSettings(new GitCommitSettings(), c),
  commitCount: (c) => readCommitCount(c),
  config: (c) => runSettings(new GitConfigSettings(), c),
  configGet: (c) => readConfigGet(c),
  describe: (c) => runSettings(new GitDescribeSettings(), c),
  diff: (c) => runSettings(new GitDiffSettings(), c),
  forEachRef: (c) => runSettings(new GitForEachRefSettings(), c),
  fetch: (c) => runSettings(new GitFetchSettings(), c),
  grep: (c) => runSettings(new GitGrepSettings(), c),
  help: (c) => runSettings(new GitHelpSettings(), c),
  isAncestor: (c) => readIsAncestor(c),
  isIgnored: (c) => readIsIgnored(c),
  isSignatureValid: (c) => readIsSignatureValid(c),
  isTagSignatureValid: (c) => readIsTagSignatureValid(c),
  lsFiles: (c) => runSettings(new GitLsFilesSettings(), c),
  lsRemote: (c) => runSettings(new GitLsRemoteSettings(), c),
  lsTree: (c) => runSettings(new GitLsTreeSettings(), c),
  log: (c) => runSettings(new GitLogSettings(), c),
  merge: (c) => runSettings(new GitMergeSettings(), c),
  mergeBase: (c) => readMergeBase(c),
  mergeTree: (c) => runSettings(new GitMergeTreeSettings(), c),
  mergesCleanly: (c) => readMergesCleanly(c),
  nameRev: (c) => runSettings(new GitNameRevSettings(), c),
  pull: (c) => runSettings(new GitPullSettings(), c),
  push: (c) => runSettings(new GitPushSettings(), c),
  rebase: (c) => runSettings(new GitRebaseSettings(), c),
  refs: (c) => readRefs(c),
  remote: (c) => runSettings(new GitRemoteSettings(), c),
  revList: (c) => runSettings(new GitRevListSettings(), c),
  reset: (c) => runSettings(new GitResetSettings(), c),
  restore: (c) => runSettings(new GitRestoreSettings(), c),
  rm: (c) => runSettings(new GitRmSettings(), c),
  run: (c) => runSettings(new GitRunSettings(), c),
  show: (c) => runSettings(new GitShowSettings(), c),
  showRef: (c) => runSettings(new GitShowRefSettings(), c),
  shortlog: (c) => runSettings(new GitShortlogSettings(), c),
  shortlogEntries: (c) => readShortlogEntries(c),
  stash: (c) => runSettings(new GitStashSettings(), c),
  status: (c) => runSettings(new GitStatusSettings(), c),
  submodule: (c) => runSettings(new GitSubmoduleSettings(), c),
  switch: (c) => runSettings(new GitSwitchSettings(), c),
  symbolicRef: (c) => runSettings(new GitSymbolicRefSettings(), c),
  tag: (c) => runSettings(new GitTagSettings(), c),
  treeEntries: (c) => readTreeEntries(c),
  verifyCommit: (c) => runSettings(new GitVerifyCommitSettings(), c),
  verifyTag: (c) => runSettings(new GitVerifyTagSettings(), c),
  worktreeList: (c) => listWorktrees(c),
};
