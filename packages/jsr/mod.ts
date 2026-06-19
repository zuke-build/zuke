/**
 * `@zuke/jsr` — tools for the [JSR](https://jsr.io) registry in Zuke builds:
 * typed `JsrTasks` wrappers for the `jsr` CLI (publish, add, remove), plus
 * read-only registry queries to check which versions are already published.
 *
 * ```ts
 * import { isPublished, JsrTasks } from "jsr:@zuke/jsr";
 *
 * if (!(await isPublished("@zuke/core", "0.13.0"))) {
 *   await JsrTasks.publish((s) => s.allowDirty());
 * }
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
export {
  isPublished,
  type JsrRegistryOptions,
  jsrVersions,
  publishedVersions,
} from "./src/registry.ts";
