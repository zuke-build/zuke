// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/git` — typed `git` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. Typed tasks cover the everyday commands — staging, committing,
 * branching, transferring, inspecting history, integrating work, remotes,
 * config, submodules, archives, patches — and `GitTasks.run` with
 * `.command(...)` covers the long tail.
 *
 * ```ts
 * import { GitTasks, gitInfo } from "jsr:@zuke/git";
 * await GitTasks.commit((s) => s.all().message("ci: release"));
 * const changed = await GitTasks.diffNames((s) => s.mergeBase("origin/main"));
 * const { branch, shortCommit } = await gitInfo();
 * ```
 *
 * A handful of tasks hand back parsed values rather than raw output —
 * `statusEntries`, `logEntries`, `diffNames`, `lsFileNames`, `remoteList`,
 * `worktreeList`, `revision`, `configGet`, `defaultBranch` — so a target reads
 * git's answer instead of scraping stdout. The `gitInfo()` helper resolves
 * repository metadata (branch, commit, tag, dirty state, remote) for
 * versioning and conditional steps.
 *
 * @module
 */

export * from "./src/settings.ts";
export * from "./src/git.ts";
export * from "./src/git_info.ts";
export * from "./src/repository.ts";
export * from "./src/staging.ts";
export * from "./src/commit.ts";
export * from "./src/branch.ts";
export * from "./src/tag.ts";
export * from "./src/transfer.ts";
export * from "./src/sequencer.ts";
export * from "./src/merge.ts";
export * from "./src/reset.ts";
export * from "./src/stash.ts";
export * from "./src/submodule.ts";
export * from "./src/archive.ts";
export * from "./src/apply.ts";
export {
  type GitCommitEntry,
  GitLogSettings,
  GitShowSettings,
  LOG_ENTRY_FORMAT,
} from "./src/log.ts";
export { GitDiffSettings } from "./src/diff.ts";
export { GitLsFilesSettings } from "./src/ls_files.ts";
export { GitDescribeSettings, GitRevParseSettings } from "./src/revision.ts";
export { type GitStatusEntry, GitStatusSettings } from "./src/status.ts";
export {
  GitLsRemoteSettings,
  type GitRemote,
  GitRemoteSettings,
} from "./src/remote.ts";
export { GitConfigSettings } from "./src/config.ts";
export {
  GitCherryPickSettings,
  GitReplaySettings,
  GitRevertSettings,
} from "./src/replay.ts";
export { type GitWorktree, GitWorktreeSettings } from "./src/worktree.ts";
export { GitDefaultBranchSettings } from "./src/default_branch.ts";
