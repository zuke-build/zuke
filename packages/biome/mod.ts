// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/biome` — typed `BiomeTasks` wrappers for the [Biome](https://biomejs.dev)
 * CLI (lint + format + import organizing in one tool), for use in Zuke builds.
 *
 * ```ts
 * import { BiomeTasks } from "jsr:@zuke/biome";
 *
 * await BiomeTasks.ci((s) => s.paths("src"));
 * await BiomeTasks.check((s) => s.write().paths("src"));
 * ```
 *
 * @module
 */

export {
  BiomeCheckSettings,
  BiomeCiSettings,
  BiomeFormatSettings,
  BiomeLintSettings,
  BiomeSettings,
  BiomeTasks,
  type BiomeTasksApi,
} from "./src/biome.ts";
