/**
 * `@zuke/husky` — typed `husky` task wrappers for Zuke builds.
 *
 * [`husky`](https://typicode.github.io/husky) manages Git hooks. Configure a
 * fluent settings object in a lambda; the task builds the argv and runs it.
 *
 * ```ts
 * import { HuskyTasks } from "jsr:@zuke/husky";
 * await HuskyTasks.init();
 * await HuskyTasks.install();
 * ```
 *
 * @module
 */

export * from "./src/husky.ts";
