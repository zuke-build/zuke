/**
 * `@zuke/jsr` — typed `JsrTasks` wrappers for the [JSR](https://jsr.io) CLI, for
 * use in Zuke builds (publishing and managing JSR dependencies).
 *
 * ```ts
 * import { JsrTasks } from "jsr:@zuke/jsr";
 *
 * await JsrTasks.publish((s) => s.dryRun());
 * await JsrTasks.add((s) => s.packages("@std/assert"));
 * ```
 *
 * @module
 */

export {
  JsrAddSettings,
  JsrPublishSettings,
  JsrRemoveSettings,
  JsrTasks,
  type JsrTasksApi,
} from "./src/jsr.ts";
