/**
 * `@zuke/kustomize` — typed `KustomizeTasks` wrappers for the
 * [Kustomize](https://kustomize.io) CLI, for use in Zuke builds.
 *
 * ```ts
 * import { KustomizeTasks } from "jsr:@zuke/kustomize";
 *
 * await KustomizeTasks.build((s) => s.dir("overlays/prod"));
 * await KustomizeTasks.editSetImage((s) => s.image("api", "api:1.4"));
 * ```
 *
 * @module
 */

export {
  KustomizeBuildSettings,
  KustomizeEditSetImageSettings,
  KustomizeTasks,
  type KustomizeTasksApi,
} from "./src/kustomize.ts";
