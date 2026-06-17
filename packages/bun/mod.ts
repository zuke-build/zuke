/**
 * `@zuke/bun` — typed `BunTasks` wrappers for the `bun` CLI, for use in Zuke
 * build targets (package management, scripts, and the built-in test runner).
 *
 * ```ts
 * import { BunTasks } from "jsr:@zuke/bun";
 *
 * await BunTasks.install((s) => s.frozenLockfile());
 * await BunTasks.run((s) => s.script("build"));
 * ```
 *
 * @module
 */

export {
  BunAddSettings,
  BunInstallSettings,
  BunRemoveSettings,
  BunRunSettings,
  BunTasks,
  type BunTasksApi,
  BunTestSettings,
  BunXSettings,
} from "./src/bun.ts";
