/**
 * `@zuke/knip` — a typed `KnipTasks` wrapper for the [Knip](https://knip.dev)
 * CLI (unused files, dependencies, and exports), for use in Zuke builds.
 *
 * ```ts
 * import { KnipTasks } from "jsr:@zuke/knip";
 *
 * await KnipTasks.run((s) => s.production().strict());
 * ```
 *
 * @module
 */

export { KnipRunSettings, KnipTasks, type KnipTasksApi } from "./src/knip.ts";
