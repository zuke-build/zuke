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

export {
  DenoCacheSettings,
  DenoCheckSettings,
  DenoCoverageSettings,
  DenoFmtSettings,
  DenoLintSettings,
  type DenoPermission,
  DenoRunSettings,
  DenoTasks,
  type DenoTasksApi,
  DenoTaskSettings,
  DenoTestSettings,
} from "./src/deno.ts";
