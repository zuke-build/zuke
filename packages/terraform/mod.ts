/**
 * `@zuke/terraform` — typed `TerraformTasks` wrappers for the `terraform` CLI,
 * for use in Zuke build targets (infrastructure-as-code workflows).
 *
 * ```ts
 * import { TerraformTasks } from "jsr:@zuke/terraform";
 *
 * await TerraformTasks.init((s) => s.upgrade());
 * await TerraformTasks.apply((s) => s.autoApprove().var("env", "prod"));
 * ```
 *
 * @module
 */

export {
  TerraformApplySettings,
  TerraformDestroySettings,
  TerraformFmtSettings,
  TerraformInitSettings,
  TerraformOutputSettings,
  TerraformPlanSettings,
  TerraformSettings,
  TerraformTasks,
  type TerraformTasksApi,
  TerraformValidateSettings,
} from "./src/terraform.ts";
