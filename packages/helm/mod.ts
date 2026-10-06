// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/helm` — typed `HelmTasks` wrappers for the [Helm](https://helm.sh) CLI,
 * for packaging and deploying to Kubernetes from a Zuke build.
 *
 * ```ts
 * import { HelmTasks } from "@zuke/helm";
 *
 * await HelmTasks.upgrade((s) =>
 *   s.release("api").chart("./charts/api").install().namespace("prod").wait()
 * );
 * ```
 *
 * `helmCanary` makes a pair of releases a platform for a `@zuke/canary`
 * rollout.
 *
 * @module
 */

export {
  HelmDependencyUpdateSettings,
  HelmGetAllSettings,
  HelmInstallSettings,
  HelmLintSettings,
  HelmPackageSettings,
  HelmRepoAddSettings,
  HelmRollbackSettings,
  HelmSettings,
  HelmTasks,
  type HelmTasksApi,
  HelmTemplateSettings,
  HelmUninstallSettings,
  HelmUpgradeSettings,
  HelmValuesSettings,
} from "./src/helm.ts";
export {
  HelmCanary,
  helmCanary,
  type HelmCanaryContext,
  HelmCanarySettings,
  type HelmSettingsRunner,
} from "./src/helm_canary.ts";
