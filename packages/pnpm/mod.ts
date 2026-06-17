/**
 * `@zuke/pnpm` — typed `PnpmTasks` wrappers for the `pnpm` CLI, for use in Zuke
 * build targets (including builds that drive Node/workspace projects).
 *
 * ```ts
 * import { PnpmTasks } from "jsr:@zuke/pnpm";
 *
 * await PnpmTasks.install((s) => s.frozenLockfile());
 * await PnpmTasks.run((s) => s.script("build").filter("app"));
 * ```
 *
 * @module
 */

export {
  type PnpmAccess,
  PnpmAddSettings,
  PnpmDlxSettings,
  PnpmInstallSettings,
  PnpmPublishSettings,
  PnpmRemoveSettings,
  PnpmRunSettings,
  PnpmTasks,
  type PnpmTasksApi,
} from "./src/pnpm.ts";
