// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The {@link "./gh.ts".GhTasks} members for the GitHub Actions command groups
 * — `run`, `workflow`, `secret`, `variable`, and `cache` — and their
 * implementations.
 *
 * The package composes {@link "./gh.ts".GhTasksApi} from one interface per
 * concern, so these follow that shape rather than growing one flat interface.
 * {@link "./groups.ts".ghGroupTasks} does the same for `pr`, `issue`, and
 * `release`.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import {
  GhRunCancelSettings,
  GhRunDeleteSettings,
  GhRunDownloadSettings,
  type GhRunEntry,
  GhRunListSettings,
  GhRunRerunSettings,
  GhRunViewSettings,
  GhRunWatchSettings,
  readRuns,
} from "./actions_run.ts";
import {
  GhWorkflowDisableSettings,
  GhWorkflowEnableSettings,
  type GhWorkflowEntry,
  GhWorkflowListSettings,
  GhWorkflowRunSettings,
  GhWorkflowViewSettings,
  readWorkflows,
} from "./workflow_command.ts";
import {
  GhSecretDeleteSettings,
  type GhSecretEntry,
  GhSecretListSettings,
  GhSecretSetSettings,
  readSecrets,
} from "./secret.ts";
import {
  GhVariableDeleteSettings,
  type GhVariableEntry,
  GhVariableGetSettings,
  GhVariableListSettings,
  GhVariableSetSettings,
  readVariables,
  readVariableValue,
} from "./variable.ts";
import {
  GhCacheDeleteSettings,
  type GhCacheEntry,
  GhCacheListSettings,
  readCaches,
} from "./cache.ts";

/** The `gh run` members of {@link "./gh.ts".GhTasks}. */
export interface GhRunApi {
  /** List workflow runs: `gh run list`. */
  runList(configure?: Configure<GhRunListSettings>): Promise<CommandOutput>;
  /**
   * The runs as parsed {@link GhRunEntry} values — the reader a build branches
   * on. The `--json` field set is pinned, since gh requires one by name.
   */
  runListEntries(
    configure?: Configure<GhRunListSettings>,
  ): Promise<GhRunEntry[]>;
  /** Show a run: `gh run view`. */
  runView(configure?: Configure<GhRunViewSettings>): Promise<CommandOutput>;
  /** Rerun a run, or its failed jobs: `gh run rerun`. */
  runRerun(configure?: Configure<GhRunRerunSettings>): Promise<CommandOutput>;
  /** Stop a run: `gh run cancel`. */
  runCancel(configure?: Configure<GhRunCancelSettings>): Promise<CommandOutput>;
  /** Remove a run: `gh run delete`. */
  runDelete(configure?: Configure<GhRunDeleteSettings>): Promise<CommandOutput>;
  /** Fetch a run's artifacts: `gh run download`. */
  runDownload(
    configure?: Configure<GhRunDownloadSettings>,
  ): Promise<CommandOutput>;
  /**
   * Follow a run until it finishes: `gh run watch`. A target that watches
   * blocks until Actions is done, so pair it with `.killAfter(...)` unless
   * the wait is the point.
   */
  runWatch(configure?: Configure<GhRunWatchSettings>): Promise<CommandOutput>;
}

/** The `gh workflow` members of {@link "./gh.ts".GhTasks}. */
export interface GhWorkflowApi {
  /** List workflows: `gh workflow list`. */
  workflowList(
    configure?: Configure<GhWorkflowListSettings>,
  ): Promise<CommandOutput>;
  /**
   * The workflows as parsed {@link GhWorkflowEntry} values. The `--json` field
   * set is pinned, since gh requires one by name.
   */
  workflowListEntries(
    configure?: Configure<GhWorkflowListSettings>,
  ): Promise<GhWorkflowEntry[]>;
  /** Show a workflow, or its YAML: `gh workflow view`. */
  workflowView(
    configure?: Configure<GhWorkflowViewSettings>,
  ): Promise<CommandOutput>;
  /**
   * Dispatch a workflow: `gh workflow run`. This returns once the dispatch is
   * accepted; {@link "./workflow.ts".githubWorkflow} is the wait trigger that
   * suspends the build until the run finishes.
   */
  workflowRun(
    configure?: Configure<GhWorkflowRunSettings>,
  ): Promise<CommandOutput>;
  /** Turn a workflow on: `gh workflow enable`. */
  workflowEnable(
    configure?: Configure<GhWorkflowEnableSettings>,
  ): Promise<CommandOutput>;
  /** Turn a workflow off: `gh workflow disable`. */
  workflowDisable(
    configure?: Configure<GhWorkflowDisableSettings>,
  ): Promise<CommandOutput>;
}

/** The `gh secret` members of {@link "./gh.ts".GhTasks}. */
export interface GhSecretApi {
  /**
   * Store a secret: `gh secret set`. A value passed as `.body(...)` becomes an
   * argv entry and is readable in a process listing — see the module docs of
   * {@link "./secret.ts".GhSecretSetSettings} for the alternatives.
   */
  secretSet(configure?: Configure<GhSecretSetSettings>): Promise<CommandOutput>;
  /** List the secrets' names: `gh secret list`. */
  secretList(
    configure?: Configure<GhSecretListSettings>,
  ): Promise<CommandOutput>;
  /**
   * The secrets as parsed {@link GhSecretEntry} values — names and metadata;
   * GitHub never returns a secret's value.
   */
  secretListEntries(
    configure?: Configure<GhSecretListSettings>,
  ): Promise<GhSecretEntry[]>;
  /** Remove a secret: `gh secret delete`. */
  secretDelete(
    configure?: Configure<GhSecretDeleteSettings>,
  ): Promise<CommandOutput>;
}

/** The `gh variable` members of {@link "./gh.ts".GhTasks}. */
export interface GhVariableApi {
  /** Store a variable: `gh variable set`. */
  variableSet(
    configure?: Configure<GhVariableSetSettings>,
  ): Promise<CommandOutput>;
  /** Read a variable: `gh variable get`. */
  variableGet(
    configure?: Configure<GhVariableGetSettings>,
  ): Promise<CommandOutput>;
  /** A variable's value, with the trailing newline gh prints removed. */
  variableValue(
    configure?: Configure<GhVariableGetSettings>,
  ): Promise<string>;
  /** List variables: `gh variable list`. */
  variableList(
    configure?: Configure<GhVariableListSettings>,
  ): Promise<CommandOutput>;
  /**
   * The variables as parsed {@link GhVariableEntry} values, values included —
   * a variable is not a secret.
   */
  variableListEntries(
    configure?: Configure<GhVariableListSettings>,
  ): Promise<GhVariableEntry[]>;
  /** Remove a variable: `gh variable delete`. */
  variableDelete(
    configure?: Configure<GhVariableDeleteSettings>,
  ): Promise<CommandOutput>;
}

/** The `gh cache` members of {@link "./gh.ts".GhTasks}. */
export interface GhCacheApi {
  /** List the Actions caches: `gh cache list`. */
  cacheList(configure?: Configure<GhCacheListSettings>): Promise<CommandOutput>;
  /**
   * The caches as parsed {@link GhCacheEntry} values — what a build reads to
   * decide which ones to reclaim.
   */
  cacheListEntries(
    configure?: Configure<GhCacheListSettings>,
  ): Promise<GhCacheEntry[]>;
  /** Reclaim caches: `gh cache delete`. */
  cacheDelete(
    configure?: Configure<GhCacheDeleteSettings>,
  ): Promise<CommandOutput>;
}

/**
 * The implementations of the Actions groups, spread into
 * {@link "./gh.ts".GhTasks}.
 */
export const ghActionsTasks:
  & GhRunApi
  & GhWorkflowApi
  & GhSecretApi
  & GhVariableApi
  & GhCacheApi = {
    runList: (c) => runSettings(new GhRunListSettings(), c),
    runListEntries: (c) => readRuns(c),
    runView: (c) => runSettings(new GhRunViewSettings(), c),
    runRerun: (c) => runSettings(new GhRunRerunSettings(), c),
    runCancel: (c) => runSettings(new GhRunCancelSettings(), c),
    runDelete: (c) => runSettings(new GhRunDeleteSettings(), c),
    runDownload: (c) => runSettings(new GhRunDownloadSettings(), c),
    runWatch: (c) => runSettings(new GhRunWatchSettings(), c),
    workflowList: (c) => runSettings(new GhWorkflowListSettings(), c),
    workflowListEntries: (c) => readWorkflows(c),
    workflowView: (c) => runSettings(new GhWorkflowViewSettings(), c),
    workflowRun: (c) => runSettings(new GhWorkflowRunSettings(), c),
    workflowEnable: (c) => runSettings(new GhWorkflowEnableSettings(), c),
    workflowDisable: (c) => runSettings(new GhWorkflowDisableSettings(), c),
    secretSet: (c) => runSettings(new GhSecretSetSettings(), c),
    secretList: (c) => runSettings(new GhSecretListSettings(), c),
    secretListEntries: (c) => readSecrets(c),
    secretDelete: (c) => runSettings(new GhSecretDeleteSettings(), c),
    variableSet: (c) => runSettings(new GhVariableSetSettings(), c),
    variableGet: (c) => runSettings(new GhVariableGetSettings(), c),
    variableValue: (c) => readVariableValue(c),
    variableList: (c) => runSettings(new GhVariableListSettings(), c),
    variableListEntries: (c) => readVariables(c),
    variableDelete: (c) => runSettings(new GhVariableDeleteSettings(), c),
    cacheList: (c) => runSettings(new GhCacheListSettings(), c),
    cacheListEntries: (c) => readCaches(c),
    cacheDelete: (c) => runSettings(new GhCacheDeleteSettings(), c),
  };
