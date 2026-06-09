/**
 * `@zuke/npm` — typed `NpmTasks` wrappers for the `npm` CLI, for use in Zuke
 * build targets (including builds that drive Node projects).
 *
 * ```ts
 * import { NpmTasks } from "jsr:@zuke/npm";
 *
 * await NpmTasks.ci();
 * await NpmTasks.run((s) => s.script("build"));
 * ```
 *
 * @module
 */

export {
  type NpmAccess,
  NpmCiSettings,
  NpmExecSettings,
  NpmInstallSettings,
  type NpmOmitType,
  NpmPublishSettings,
  NpmRunSettings,
  NpmTasks,
  type NpmTasksApi,
  NpmVersionSettings,
} from "./src/npm.ts";
