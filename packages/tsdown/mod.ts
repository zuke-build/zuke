// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/tsdown` — a typed `TsdownTasks` wrapper for the
 * [tsdown](https://tsdown.dev) bundler, for use in Zuke builds.
 *
 * ```ts
 * import { TsdownTasks } from "jsr:@zuke/tsdown";
 *
 * await TsdownTasks.build((s) =>
 *   s.entry("src/index.ts").format("esm", "cjs").dts().minify().clean()
 * );
 * ```
 *
 * @module
 */

export {
  TsdownBuildSettings,
  type TsdownFormat,
  TsdownMigrateSettings,
  TsdownTasks,
  type TsdownTasksApi,
} from "./src/tsdown.ts";
