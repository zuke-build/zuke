/**
 * `@zuke/yarn` — typed `YarnTasks` wrappers for the `yarn` CLI, for use in Zuke
 * build targets (Yarn Classic v1 and Berry v2+; version-specific options are
 * documented on each method).
 *
 * ```ts
 * import { YarnTasks } from "jsr:@zuke/yarn";
 *
 * await YarnTasks.install((s) => s.immutable());
 * await YarnTasks.run((s) => s.script("build"));
 * ```
 *
 * @module
 */

export {
  YarnAddSettings,
  YarnDlxSettings,
  YarnInstallSettings,
  YarnRemoveSettings,
  YarnRunSettings,
  YarnSettings,
  YarnTasks,
  type YarnTasksApi,
} from "./src/yarn.ts";
