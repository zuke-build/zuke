/**
 * `@zuke/tsup` — a typed `TsupTasks` wrapper for the
 * [tsup](https://tsup.egoist.dev) bundler, for use in Zuke builds.
 *
 * ```ts
 * import { TsupTasks } from "jsr:@zuke/tsup";
 *
 * await TsupTasks.build((s) =>
 *   s.entry("src/index.ts").format("esm", "cjs").dts().minify().clean()
 * );
 * ```
 *
 * @module
 */

export {
  TsupBuildSettings,
  type TsupFormat,
  TsupTasks,
  type TsupTasksApi,
} from "./src/tsup.ts";
