// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
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

test("the default binary is terraform", () => {
  assertEquals(new TerraformInitSettings().argv()[0], "terraform");
});

test("init: bare and all flags", () => {
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

test("validate: bare and -json", () => {
  assertEquals(new TerraformValidateSettings().argv().slice(1), ["validate"]);
  assertEquals(
    new TerraformValidateSettings().json().argv().slice(1),
    ["validate", "-json"],
  );
});

test("plan: out, vars, var-files, -destroy, -input=false", () => {
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

test("apply: auto-approve, vars, var-files, -input=false, plan file", () => {
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

test("destroy: auto-approve, vars, var-files", () => {
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

test("fmt: bare, -check, -recursive, -diff", () => {
  assertEquals(new TerraformFmtSettings().argv().slice(1), ["fmt"]);
  assertEquals(
    new TerraformFmtSettings().check().recursive().diff().argv().slice(1),
    ["fmt", "-check", "-recursive", "-diff"],
  );
});

test("output: bare, -json, -raw, and a name", () => {
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

test("every TerraformTasks function reaches execution", async () => {
  await assertRejects(
    () => TerraformTasks.init(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(
    () => TerraformTasks.validate(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(
    () => TerraformTasks.plan(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(
    () => TerraformTasks.apply(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(
    () => TerraformTasks.destroy(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(() => TerraformTasks.fmt(missingTool), ToolNotFoundError);
  await assertRejects(
    () => TerraformTasks.output(missingTool),
    ToolNotFoundError,
  );
});

test("terraform: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(
    () => new TerraformInitSettings(),
    "terraform",
    {
      resolution: "path",
    },
  );
});
