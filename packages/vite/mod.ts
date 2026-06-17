/**
 * `@zuke/vite` — typed `ViteTasks` wrappers for the [Vite](https://vitejs.dev)
 * CLI, for use in Zuke builds.
 *
 * ```ts
 * import { ViteTasks } from "jsr:@zuke/vite";
 *
 * await ViteTasks.build((s) => s.outDir("dist").mode("production"));
 * await ViteTasks.preview((s) => s.port(4173));
 * ```
 *
 * @module
 */

export {
  ViteBuildSettings,
  ViteDevSettings,
  VitePreviewSettings,
  ViteTasks,
  type ViteTasksApi,
} from "./src/vite.ts";
