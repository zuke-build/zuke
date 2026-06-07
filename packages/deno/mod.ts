/**
 * `@zuke/deno` — typed `DenoTasks` wrappers for the `deno` CLI, for use in
 * Zuke build targets.
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
