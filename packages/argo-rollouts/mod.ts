// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/argo-rollouts` — typed `ArgoRolloutsTasks` wrappers for the
 * [Argo Rollouts](https://argo-rollouts.readthedocs.io) kubectl plugin
 * (`kubectl argo rollouts`), for use in Zuke builds.
 *
 * ```ts
 * import { ArgoRolloutsTasks } from "@zuke/argo-rollouts";
 *
 * await ArgoRolloutsTasks.setImage((s) =>
 *   s.name("api").image("api", "acme/api:1.4.0").namespace("prod")
 * );
 * await ArgoRolloutsTasks.status((s) => s.name("api").timeout("10m"));
 * await ArgoRolloutsTasks.promote((s) => s.name("api").full());
 * ```
 *
 * Traffic weights are not set from the command line: they come from the
 * `setWeight` steps in the Rollout's own manifest. A build starts a rollout
 * with {@link ArgoRolloutsTasks.setImage}, advances it past each pause with
 * {@link ArgoRolloutsTasks.promote}, and backs it out with
 * {@link ArgoRolloutsTasks.abort}.
 *
 * @module
 */

export {
  ArgoRolloutsNamedSettings,
  ArgoRolloutsSettings,
} from "./src/settings.ts";
export {
  ArgoRolloutsPromoteSettings,
  ArgoRolloutsRestartSettings,
  ArgoRolloutsSetImageSettings,
  ArgoRolloutsStatusSettings,
  ArgoRolloutsUndoSettings,
} from "./src/rollout.ts";
export {
  ArgoRolloutsGetExperimentSettings,
  ArgoRolloutsGetRolloutSettings,
  ArgoRolloutsListExperimentsSettings,
  ArgoRolloutsListRolloutsSettings,
  ArgoRolloutsVersionSettings,
} from "./src/inspect.ts";
export {
  ArgoRolloutsCreateAnalysisRunSettings,
  ArgoRolloutsCreateSettings,
  ArgoRolloutsLintSettings,
} from "./src/create.ts";
export { ArgoRolloutsTasks, type ArgoRolloutsTasksApi } from "./src/tasks.ts";
