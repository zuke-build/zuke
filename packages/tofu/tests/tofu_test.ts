// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  TofuApplySettings,
  TofuDestroySettings,
  TofuFmtSettings,
  TofuInitSettings,
  TofuOutputSettings,
  TofuPlanSettings,
  TofuTasks,
  TofuValidateSettings,
} from "../src/tofu.ts";

Deno.test("the default binary is tofu", () => {
  assertEquals(new TofuInitSettings().argv()[0], "tofu");
});

Deno.test("init: bare and all flags", () => {
  assertEquals(new TofuInitSettings().argv().slice(1), ["init"]);
  assertEquals(
    new TofuInitSettings()
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
  assertEquals(new TofuValidateSettings().argv().slice(1), ["validate"]);
  assertEquals(
    new TofuValidateSettings().json().argv().slice(1),
    ["validate", "-json"],
  );
});

Deno.test("plan: out, vars, var-files, -destroy, -input=false", () => {
  assertEquals(new TofuPlanSettings().argv().slice(1), ["plan"]);
  assertEquals(
    new TofuPlanSettings()
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
  assertEquals(new TofuApplySettings().argv().slice(1), ["apply"]);
  assertEquals(
    new TofuApplySettings()
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
  assertEquals(new TofuDestroySettings().argv().slice(1), ["destroy"]);
  assertEquals(
    new TofuDestroySettings()
      .autoApprove()
      .var("env", "prod")
      .varFile("prod.tfvars")
      .argv()
      .slice(1),
    ["destroy", "-auto-approve", "-var=env=prod", "-var-file=prod.tfvars"],
  );
});

Deno.test("fmt: bare, -check, -recursive, -diff", () => {
  assertEquals(new TofuFmtSettings().argv().slice(1), ["fmt"]);
  assertEquals(
    new TofuFmtSettings().check().recursive().diff().argv().slice(1),
    ["fmt", "-check", "-recursive", "-diff"],
  );
});

Deno.test("output: bare, -json, -raw, and a name", () => {
  assertEquals(new TofuOutputSettings().argv().slice(1), ["output"]);
  assertEquals(
    new TofuOutputSettings().raw().name("ip").argv().slice(1),
    ["output", "-raw", "ip"],
  );
  assertEquals(
    new TofuOutputSettings().json().argv().slice(1),
    ["output", "-json"],
  );
});

Deno.test("every TofuTasks function reaches execution", async () => {
  await assertRejects(() => TofuTasks.init(missingTool), ToolNotFoundError);
  await assertRejects(() => TofuTasks.validate(missingTool), ToolNotFoundError);
  await assertRejects(() => TofuTasks.plan(missingTool), ToolNotFoundError);
  await assertRejects(() => TofuTasks.apply(missingTool), ToolNotFoundError);
  await assertRejects(() => TofuTasks.destroy(missingTool), ToolNotFoundError);
  await assertRejects(() => TofuTasks.fmt(missingTool), ToolNotFoundError);
  await assertRejects(() => TofuTasks.output(missingTool), ToolNotFoundError);
});

Deno.test("tofu: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(() => new TofuInitSettings(), "tofu", {
    resolution: "path",
  });
});
