// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `ArgoRolloutsTasks` — typed task functions for the
 * [Argo Rollouts](https://argo-rollouts.readthedocs.io) kubectl plugin, in the
 * settings-lambda style: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { ArgoRolloutsNamedSettings } from "./settings.ts";
import {
  ArgoRolloutsPromoteSettings,
  ArgoRolloutsRestartSettings,
  ArgoRolloutsSetImageSettings,
  ArgoRolloutsStatusSettings,
  ArgoRolloutsUndoSettings,
} from "./rollout.ts";
import {
  ArgoRolloutsGetExperimentSettings,
  ArgoRolloutsGetRolloutSettings,
  ArgoRolloutsListExperimentsSettings,
  ArgoRolloutsListRolloutsSettings,
  ArgoRolloutsVersionSettings,
} from "./inspect.ts";
import {
  ArgoRolloutsCreateAnalysisRunSettings,
  ArgoRolloutsCreateSettings,
  ArgoRolloutsLintSettings,
} from "./create.ts";

/** The shape of {@link ArgoRolloutsTasks}. */
export interface ArgoRolloutsTasksApi {
  /** Point a rollout's container at a new image, starting a rollout: `set image`. */
  setImage(
    configure?: Configure<ArgoRolloutsSetImageSettings>,
  ): Promise<CommandOutput>;
  /** Advance a paused rollout, or promote it fully: `promote`. */
  promote(
    configure?: Configure<ArgoRolloutsPromoteSettings>,
  ): Promise<CommandOutput>;
  /** Abort a rollout, returning traffic to the stable version: `abort`. */
  abort(
    configure?: Configure<ArgoRolloutsNamedSettings>,
  ): Promise<CommandOutput>;
  /** Pause a rollout where it is: `pause`. */
  pause(
    configure?: Configure<ArgoRolloutsNamedSettings>,
  ): Promise<CommandOutput>;
  /** Report, or watch, a rollout's status: `status`. */
  status(
    configure?: Configure<ArgoRolloutsStatusSettings>,
  ): Promise<CommandOutput>;
  /** Roll a rollout back to an earlier revision: `undo`. */
  undo(
    configure?: Configure<ArgoRolloutsUndoSettings>,
  ): Promise<CommandOutput>;
  /** Restart a rollout's pods: `restart`. */
  restart(
    configure?: Configure<ArgoRolloutsRestartSettings>,
  ): Promise<CommandOutput>;
  /** Retry an aborted rollout: `retry rollout`. */
  retryRollout(
    configure?: Configure<ArgoRolloutsNamedSettings>,
  ): Promise<CommandOutput>;
  /** Retry an experiment: `retry experiment`. */
  retryExperiment(
    configure?: Configure<ArgoRolloutsNamedSettings>,
  ): Promise<CommandOutput>;
  /** Terminate a running analysis run: `terminate analysisrun`. */
  terminateAnalysisRun(
    configure?: Configure<ArgoRolloutsNamedSettings>,
  ): Promise<CommandOutput>;
  /** Terminate a running experiment: `terminate experiment`. */
  terminateExperiment(
    configure?: Configure<ArgoRolloutsNamedSettings>,
  ): Promise<CommandOutput>;
  /** Show a rollout: `get rollout`. */
  getRollout(
    configure?: Configure<ArgoRolloutsGetRolloutSettings>,
  ): Promise<CommandOutput>;
  /** Show an experiment: `get experiment`. */
  getExperiment(
    configure?: Configure<ArgoRolloutsGetExperimentSettings>,
  ): Promise<CommandOutput>;
  /** List rollouts: `list rollouts`. */
  listRollouts(
    configure?: Configure<ArgoRolloutsListRolloutsSettings>,
  ): Promise<CommandOutput>;
  /** List experiments: `list experiments`. */
  listExperiments(
    configure?: Configure<ArgoRolloutsListExperimentsSettings>,
  ): Promise<CommandOutput>;
  /** Create a Rollout or Experiment from files: `create`. */
  create(
    configure?: Configure<ArgoRolloutsCreateSettings>,
  ): Promise<CommandOutput>;
  /** Run an analysis template once: `create analysisrun`. */
  createAnalysisRun(
    configure?: Configure<ArgoRolloutsCreateAnalysisRunSettings>,
  ): Promise<CommandOutput>;
  /** Validate a Rollout manifest: `lint`. */
  lint(
    configure?: Configure<ArgoRolloutsLintSettings>,
  ): Promise<CommandOutput>;
  /** Print the plugin's version: `version`. */
  version(
    configure?: Configure<ArgoRolloutsVersionSettings>,
  ): Promise<CommandOutput>;
}

/** Fresh settings for a subcommand whose only operand is a name. */
function named(
  command: readonly string[],
  task: string,
): ArgoRolloutsNamedSettings {
  return new ArgoRolloutsNamedSettings(command, task);
}

/** Typed task functions for the Argo Rollouts kubectl plugin. */
export const ArgoRolloutsTasks: ArgoRolloutsTasksApi = {
  setImage: (configure) =>
    runSettings(new ArgoRolloutsSetImageSettings(), configure),
  promote: (configure) =>
    runSettings(new ArgoRolloutsPromoteSettings(), configure),
  abort: (configure) => runSettings(named(["abort"], "abort"), configure),
  pause: (configure) => runSettings(named(["pause"], "pause"), configure),
  status: (configure) =>
    runSettings(new ArgoRolloutsStatusSettings(), configure),
  undo: (configure) => runSettings(new ArgoRolloutsUndoSettings(), configure),
  restart: (configure) =>
    runSettings(new ArgoRolloutsRestartSettings(), configure),
  retryRollout: (configure) =>
    runSettings(named(["retry", "rollout"], "retryRollout"), configure),
  retryExperiment: (configure) =>
    runSettings(named(["retry", "experiment"], "retryExperiment"), configure),
  terminateAnalysisRun: (configure) =>
    runSettings(
      named(["terminate", "analysisrun"], "terminateAnalysisRun"),
      configure,
    ),
  terminateExperiment: (configure) =>
    runSettings(
      named(["terminate", "experiment"], "terminateExperiment"),
      configure,
    ),
  getRollout: (configure) =>
    runSettings(new ArgoRolloutsGetRolloutSettings(), configure),
  getExperiment: (configure) =>
    runSettings(new ArgoRolloutsGetExperimentSettings(), configure),
  listRollouts: (configure) =>
    runSettings(new ArgoRolloutsListRolloutsSettings(), configure),
  listExperiments: (configure) =>
    runSettings(new ArgoRolloutsListExperimentsSettings(), configure),
  create: (configure) =>
    runSettings(new ArgoRolloutsCreateSettings(), configure),
  createAnalysisRun: (configure) =>
    runSettings(new ArgoRolloutsCreateAnalysisRunSettings(), configure),
  lint: (configure) => runSettings(new ArgoRolloutsLintSettings(), configure),
  version: (configure) =>
    runSettings(new ArgoRolloutsVersionSettings(), configure),
};
