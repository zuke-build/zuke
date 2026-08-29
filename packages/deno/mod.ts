// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/deno` — typed `DenoTasks` wrappers for the `deno` CLI, for use in
 * Zuke build targets.
 *
 * ```ts
 * import { DenoTasks } from "jsr:@zuke/deno";
 *
 * await DenoTasks.check((s) => s.paths("mod.ts"));
 * await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
 * await DenoTasks.fmt((s) => s.check());
 * ```
 *
 * @module
 */

export { DenoTasks, type DenoTasksApi } from "./src/deno.ts";
export {
  type DenoPermission,
  DenoPermissionSettings,
  DenoSettings,
} from "./src/settings.ts";
export {
  DenoEvalSettings,
  DenoRunSettings,
  DenoServeSettings,
  type DenoSourceExt,
  DenoTaskSettings,
} from "./src/execution.ts";
export {
  DenoBenchSettings,
  DenoCoverageSettings,
  DenoTestSettings,
} from "./src/testing.ts";
export {
  DenoCheckSettings,
  DenoDocSettings,
  DenoFmtSettings,
  DenoLintSettings,
} from "./src/quality.ts";
export {
  DenoAddSettings,
  DenoApproveScriptsSettings,
  DenoBumpVersionSettings,
  DenoCacheSettings,
  DenoCiSettings,
  DenoInstallSettings,
  DenoLockSettings,
  DenoOutdatedSettings,
  DenoPackSettings,
  DenoPublishSettings,
  DenoRemoveSettings,
  DenoUninstallSettings,
  type DenoVersionIncrement,
  DenoWhySettings,
} from "./src/dependencies.ts";
export {
  DenoCleanSettings,
  DenoCompileSettings,
  type DenoCompileTarget,
  DenoInfoSettings,
  DenoInitSettings,
  DenoUpgradeSettings,
} from "./src/toolchain.ts";
export {
  type DenoCacheInfo,
  type DenoModule,
  type DenoModuleDependency,
  type DenoModuleGraph,
  parseCacheInfo,
  parseModuleGraph,
} from "./src/module_json.ts";
export {
  CoverageThresholdError,
  type CoverageThresholds,
} from "./src/coverage.ts";
