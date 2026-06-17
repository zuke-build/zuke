/**
 * `@zuke/tofu` — typed `TofuTasks` wrappers for the OpenTofu CLI (`tofu`), for
 * use in Zuke build targets (infrastructure-as-code workflows).
 *
 * ```ts
 * import { TofuTasks } from "jsr:@zuke/tofu";
 *
 * await TofuTasks.init((s) => s.upgrade());
 * await TofuTasks.apply((s) => s.autoApprove().var("env", "prod"));
 * ```
 *
 * @module
 */

export {
  TofuApplySettings,
  TofuDestroySettings,
  TofuFmtSettings,
  TofuInitSettings,
  TofuOutputSettings,
  TofuPlanSettings,
  TofuTasks,
  type TofuTasksApi,
  TofuValidateSettings,
} from "./src/tofu.ts";
