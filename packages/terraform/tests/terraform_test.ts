import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  TerraformApplySettings,
  TerraformDestroySettings,
  TerraformFmtSettings,
  TerraformInitSettings,
  TerraformOutputSettings,
  TerraformPlanSettings,
  TerraformTasks,
  TerraformValidateSettings,
} from "../src/terraform.ts";

Deno.test("the default binary is terraform", () => {
  assertEquals(new TerraformInitSettings().argv()[0], "terraform");
});

Deno.test("init: bare and all flags", () => {
  assertEquals(new TerraformInitSettings().argv().slice(1), ["init"]);
  assertEquals(
    new TerraformInitSettings()
      .upgrade()
      .reconfigure()
      .noBackend()
      .noInput()
      .argv()
      .slice(1),
    ["init", "-upgrade", "-reconfigure", "-backend=false", "-input=false"],
  );
});

Deno.test("validate: bare and -json", () => {
  assertEquals(new TerraformValidateSettings().argv().slice(1), ["validate"]);
  assertEquals(
    new TerraformValidateSettings().json().argv().slice(1),
    ["validate", "-json"],
  );
});

Deno.test("plan: out, vars, var-files, -destroy, -input=false", () => {
  assertEquals(new TerraformPlanSettings().argv().slice(1), ["plan"]);
  assertEquals(
    new TerraformPlanSettings()
      .out("plan.tfplan")
      .destroy()
      .noInput()
      .var("env", "prod")
      .var("region", "eu")
      .varFile("prod.tfvars")
      .argv()
      .slice(1),
    [
      "plan",
      "-out=plan.tfplan",
      "-destroy",
      "-input=false",
      "-var=env=prod",
      "-var=region=eu",
      "-var-file=prod.tfvars",
    ],
  );
});

Deno.test("apply: auto-approve, vars, var-files, -input=false, plan file", () => {
  assertEquals(new TerraformApplySettings().argv().slice(1), ["apply"]);
  assertEquals(
    new TerraformApplySettings()
      .autoApprove()
      .noInput()
      .var("env", "prod")
      .varFile("prod.tfvars")
      .planFile("plan.tfplan")
      .argv()
      .slice(1),
    [
      "apply",
      "-auto-approve",
      "-input=false",
      "-var=env=prod",
      "-var-file=prod.tfvars",
      "plan.tfplan",
    ],
  );
});

Deno.test("destroy: auto-approve, vars, var-files", () => {
  assertEquals(new TerraformDestroySettings().argv().slice(1), ["destroy"]);
  assertEquals(
    new TerraformDestroySettings()
      .autoApprove()
      .var("env", "prod")
      .varFile("prod.tfvars")
      .argv()
      .slice(1),
    ["destroy", "-auto-approve", "-var=env=prod", "-var-file=prod.tfvars"],
  );
});

Deno.test("fmt: bare, -check, -recursive, -diff", () => {
  assertEquals(new TerraformFmtSettings().argv().slice(1), ["fmt"]);
  assertEquals(
    new TerraformFmtSettings().check().recursive().diff().argv().slice(1),
    ["fmt", "-check", "-recursive", "-diff"],
  );
});

Deno.test("output: bare, -json, -raw, and a name", () => {
  assertEquals(new TerraformOutputSettings().argv().slice(1), ["output"]);
  assertEquals(
    new TerraformOutputSettings().raw().name("ip").argv().slice(1),
    ["output", "-raw", "ip"],
  );
  assertEquals(
    new TerraformOutputSettings().json().argv().slice(1),
    ["output", "-json"],
  );
});

/**
 * Point a settings object at a guaranteed-missing binary with the shim
 * fallback disabled, so each TerraformTasks function reaches execution WITHOUT
 * ever invoking a real terraform (tests must stay hermetic).
 */
const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-terraform-xyz");
};

Deno.test("every TerraformTasks function reaches execution", async () => {
  await assertRejects(() => TerraformTasks.init(missing), ToolNotFoundError);
  await assertRejects(
    () => TerraformTasks.validate(missing),
    ToolNotFoundError,
  );
  await assertRejects(() => TerraformTasks.plan(missing), ToolNotFoundError);
  await assertRejects(() => TerraformTasks.apply(missing), ToolNotFoundError);
  await assertRejects(() => TerraformTasks.destroy(missing), ToolNotFoundError);
  await assertRejects(() => TerraformTasks.fmt(missing), ToolNotFoundError);
  await assertRejects(() => TerraformTasks.output(missing), ToolNotFoundError);
});
