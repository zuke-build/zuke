// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  ArgoRolloutsCreateAnalysisRunSettings,
  ArgoRolloutsCreateSettings,
  ArgoRolloutsLintSettings,
} from "../mod.ts";

Deno.test("create: one --filename per file, plus watch and no-color", () => {
  assertEquals(
    new ArgoRolloutsCreateSettings()
      .filename("rollout.yaml", "svc.yaml")
      .watch()
      .noColor()
      .argv()
      .slice(1),
    [
      "create",
      "--filename",
      "rollout.yaml",
      "--filename",
      "svc.yaml",
      "--watch",
      "--no-color",
    ],
  );
  assertThrows(
    () => new ArgoRolloutsCreateSettings().argv(),
    Error,
    "ArgoRolloutsTasks.create: .filename() is required.",
  );
});

Deno.test("createAnalysisRun: from the cluster with every option", () => {
  assertEquals(
    new ArgoRolloutsCreateAnalysisRunSettings()
      .from("success-rate")
      .global()
      .argument("service", "api")
      .argument("threshold", "0.99")
      .name("run-1")
      .generateName("run-")
      .instanceId("east")
      .argv()
      .slice(1),
    [
      "create",
      "analysisrun",
      "--from",
      "success-rate",
      "--global",
      "--argument",
      "service=api",
      "--argument",
      "threshold=0.99",
      "--name",
      "run-1",
      "--generate-name",
      "run-",
      "--instance-id",
      "east",
    ],
  );
});

Deno.test("createAnalysisRun: from a local file", () => {
  assertEquals(
    new ArgoRolloutsCreateAnalysisRunSettings().fromFile("t.yaml").argv()
      .slice(1),
    ["create", "analysisrun", "--from-file", "t.yaml"],
  );
});

Deno.test("createAnalysisRun needs exactly one template source", () => {
  const message =
    "ArgoRolloutsTasks.createAnalysisRun: set exactly one of .from() and .fromFile().";
  assertThrows(
    () => new ArgoRolloutsCreateAnalysisRunSettings().argv(),
    Error,
    message,
  );
  assertThrows(
    () =>
      new ArgoRolloutsCreateAnalysisRunSettings().from("a").fromFile("b.yaml")
        .argv(),
    Error,
    message,
  );
});

Deno.test("lint requires a file", () => {
  assertEquals(
    new ArgoRolloutsLintSettings().filename("rollout.yaml").namespace("prod")
      .argv().slice(1),
    ["lint", "--namespace", "prod", "--filename", "rollout.yaml"],
  );
  assertThrows(
    () => new ArgoRolloutsLintSettings().argv(),
    Error,
    "ArgoRolloutsTasks.lint: .filename() is required.",
  );
});
