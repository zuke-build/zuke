// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The {@link "./gh.ts".GhTasks} members for the repository command groups —
 * `repo` and `label` — and their implementations.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import {
  GhRepoArchiveSettings,
  GhRepoCloneSettings,
  GhRepoCreateSettings,
  GhRepoDeleteSettings,
  GhRepoEditSettings,
  GhRepoForkSettings,
  GhRepoListSettings,
  GhRepoRenameSettings,
  GhRepoSetDefaultSettings,
  type GhRepositoryEntry,
  GhRepoSyncSettings,
  GhRepoViewSettings,
  readRepositories,
} from "./repo.ts";
import {
  GhLabelCloneSettings,
  GhLabelCreateSettings,
  GhLabelDeleteSettings,
  GhLabelEditSettings,
  type GhLabelEntry,
  GhLabelListSettings,
  readLabels,
} from "./label.ts";

/** The `gh repo` members of {@link "./gh.ts".GhTasks}. */
export interface GhRepoApi {
  /** Clone a repository: `gh repo clone`. */
  repoClone(configure?: Configure<GhRepoCloneSettings>): Promise<CommandOutput>;
  /** Create a repository: `gh repo create`. */
  repoCreate(
    configure?: Configure<GhRepoCreateSettings>,
  ): Promise<CommandOutput>;
  /** Show a repository: `gh repo view`. */
  repoView(configure?: Configure<GhRepoViewSettings>): Promise<CommandOutput>;
  /** List repositories: `gh repo list`. */
  repoList(configure?: Configure<GhRepoListSettings>): Promise<CommandOutput>;
  /**
   * The repositories as parsed {@link GhRepositoryEntry} values. The `--json`
   * field set is pinned, since gh requires one by name.
   */
  repoListEntries(
    configure?: Configure<GhRepoListSettings>,
  ): Promise<GhRepositoryEntry[]>;
  /** Fork a repository: `gh repo fork`. */
  repoFork(configure?: Configure<GhRepoForkSettings>): Promise<CommandOutput>;
  /** Bring a fork up to date: `gh repo sync`. */
  repoSync(configure?: Configure<GhRepoSyncSettings>): Promise<CommandOutput>;
  /** Change a repository's settings: `gh repo edit`. */
  repoEdit(configure?: Configure<GhRepoEditSettings>): Promise<CommandOutput>;
  /** Rename a repository: `gh repo rename`. */
  repoRename(
    configure?: Configure<GhRepoRenameSettings>,
  ): Promise<CommandOutput>;
  /** Archive or unarchive a repository: `gh repo archive`/`unarchive`. */
  repoArchive(
    configure?: Configure<GhRepoArchiveSettings>,
  ): Promise<CommandOutput>;
  /** Delete a repository: `gh repo delete`. Needs the `delete_repo` scope. */
  repoDelete(
    configure?: Configure<GhRepoDeleteSettings>,
  ): Promise<CommandOutput>;
  /** Choose the repository gh acts on by default: `gh repo set-default`. */
  repoSetDefault(
    configure?: Configure<GhRepoSetDefaultSettings>,
  ): Promise<CommandOutput>;
}

/** The `gh label` members of {@link "./gh.ts".GhTasks}. */
export interface GhLabelApi {
  /** List labels: `gh label list`. */
  labelList(configure?: Configure<GhLabelListSettings>): Promise<CommandOutput>;
  /**
   * The labels as parsed {@link GhLabelEntry} values. The `--json` field set
   * is pinned, since gh requires one by name.
   */
  labelListEntries(
    configure?: Configure<GhLabelListSettings>,
  ): Promise<GhLabelEntry[]>;
  /** Add a label: `gh label create`. */
  labelCreate(
    configure?: Configure<GhLabelCreateSettings>,
  ): Promise<CommandOutput>;
  /** Change a label: `gh label edit`. */
  labelEdit(configure?: Configure<GhLabelEditSettings>): Promise<CommandOutput>;
  /** Remove a label: `gh label delete`. */
  labelDelete(
    configure?: Configure<GhLabelDeleteSettings>,
  ): Promise<CommandOutput>;
  /** Copy another repository's labels: `gh label clone`. */
  labelClone(
    configure?: Configure<GhLabelCloneSettings>,
  ): Promise<CommandOutput>;
}

/**
 * The implementations of {@link GhRepoApi} and {@link GhLabelApi}, spread into
 * {@link "./gh.ts".GhTasks}.
 */
export const ghRepoTasks: GhRepoApi & GhLabelApi = {
  repoClone: (c) => runSettings(new GhRepoCloneSettings(), c),
  repoCreate: (c) => runSettings(new GhRepoCreateSettings(), c),
  repoView: (c) => runSettings(new GhRepoViewSettings(), c),
  repoList: (c) => runSettings(new GhRepoListSettings(), c),
  repoListEntries: (c) => readRepositories(c),
  repoFork: (c) => runSettings(new GhRepoForkSettings(), c),
  repoSync: (c) => runSettings(new GhRepoSyncSettings(), c),
  repoEdit: (c) => runSettings(new GhRepoEditSettings(), c),
  repoRename: (c) => runSettings(new GhRepoRenameSettings(), c),
  repoArchive: (c) => runSettings(new GhRepoArchiveSettings(), c),
  repoDelete: (c) => runSettings(new GhRepoDeleteSettings(), c),
  repoSetDefault: (c) => runSettings(new GhRepoSetDefaultSettings(), c),
  labelList: (c) => runSettings(new GhLabelListSettings(), c),
  labelListEntries: (c) => readLabels(c),
  labelCreate: (c) => runSettings(new GhLabelCreateSettings(), c),
  labelEdit: (c) => runSettings(new GhLabelEditSettings(), c),
  labelDelete: (c) => runSettings(new GhLabelDeleteSettings(), c),
  labelClone: (c) => runSettings(new GhLabelCloneSettings(), c),
};
