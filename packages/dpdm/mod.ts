/**
 * `@zuke/dpdm` — a typed `DpdmTasks` wrapper for the
 * [dpdm](https://github.com/acrazing/dpdm) CLI (module dependency graph and
 * circular-import analysis), for use in Zuke builds.
 *
 * ```ts
 * import { DpdmTasks } from "jsr:@zuke/dpdm";
 *
 * await DpdmTasks.analyze((s) =>
 *   s.noTree().noWarning().exitCode("circular:1").entries("src/index.ts")
 * );
 * ```
 *
 * @module
 */

export {
  DpdmAnalyzeSettings,
  DpdmTasks,
  type DpdmTasksApi,
} from "./src/dpdm.ts";
