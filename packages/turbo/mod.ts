/**
 * `@zuke/turbo` — typed `TurboTasks` wrappers for the
 * [Turborepo](https://turbo.build) CLI, for use in Zuke builds.
 *
 * ```ts
 * import { TurboTasks } from "jsr:@zuke/turbo";
 *
 * await TurboTasks.run((s) => s.tasks("build", "test").filter("web"));
 * ```
 *
 * @module
 */

export {
  TurboPruneSettings,
  TurboRunSettings,
  TurboTasks,
  type TurboTasksApi,
} from "./src/turbo.ts";
