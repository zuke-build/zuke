/**
 * `@zuke/nx` — typed `NxTasks` wrappers for the [Nx](https://nx.dev) CLI, for
 * use in Zuke builds.
 *
 * ```ts
 * import { NxTasks } from "jsr:@zuke/nx";
 *
 * await NxTasks.affected((s) => s.target("test").base("main"));
 * await NxTasks.runMany((s) => s.target("build").projects("web", "api"));
 * ```
 *
 * @module
 */

export {
  NxAffectedSettings,
  NxRunManySettings,
  NxRunSettings,
  NxTasks,
  type NxTasksApi,
} from "./src/nx.ts";
