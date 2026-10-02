// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { assertWrapperConformance } from "@zuke/core/tooling/conformance";
import { ArgoRolloutsNamedSettings } from "../mod.ts";

Deno.test("the default binary is the plugin, kubectl-argo-rollouts", () => {
  assertEquals(
    new ArgoRolloutsNamedSettings(["abort"], "abort").name("api").argv()[0],
    "kubectl-argo-rollouts",
  );
});

Deno.test("named settings render their command, the name, then cluster flags", () => {
  assertEquals(
    new ArgoRolloutsNamedSettings(["retry", "rollout"], "retryRollout")
      .name("api")
      .namespace("prod")
      .context("eu-west")
      .kubeconfig("/tmp/kube.yaml")
      .argv()
      .slice(1),
    [
      "retry",
      "rollout",
      "api",
      "--namespace",
      "prod",
      "--context",
      "eu-west",
      "--kubeconfig",
      "/tmp/kube.yaml",
    ],
  );
});

Deno.test("named settings require a name, naming the task", () => {
  assertThrows(
    () => new ArgoRolloutsNamedSettings(["pause"], "pause").argv(),
    Error,
    "ArgoRolloutsTasks.pause: .name() is required.",
  );
});

Deno.test("argo-rollouts: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(
    () => new ArgoRolloutsNamedSettings(["abort"], "abort").name("api"),
    "kubectl-argo-rollouts",
    { resolution: "path" },
  );
});
