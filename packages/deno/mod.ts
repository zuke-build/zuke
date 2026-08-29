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
export { DenoRunSettings, DenoTaskSettings } from "./src/execution.ts";
export { DenoCoverageSettings, DenoTestSettings } from "./src/testing.ts";
export {
  DenoCheckSettings,
  DenoDocSettings,
  DenoFmtSettings,
  DenoLintSettings,
} from "./src/quality.ts";
export {
  DenoCacheSettings,
  DenoInstallSettings,
  DenoPublishSettings,
} from "./src/dependencies.ts";
export {
  CoverageThresholdError,
  type CoverageThresholds,
} from "./src/coverage.ts";
