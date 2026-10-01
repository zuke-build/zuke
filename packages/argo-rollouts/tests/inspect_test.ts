// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  ArgoRolloutsGetExperimentSettings,
  ArgoRolloutsGetRolloutSettings,
  ArgoRolloutsListExperimentsSettings,
  ArgoRolloutsListRolloutsSettings,
  ArgoRolloutsVersionSettings,
} from "../mod.ts";

Deno.test("getRollout: bare and every flag", () => {
  assertEquals(
    new ArgoRolloutsGetRolloutSettings().name("api").argv().slice(1),
    ["get", "rollout", "api"],
  );
  assertEquals(
    new ArgoRolloutsGetRolloutSettings()
      .name("api")
      .watch()
      .noColor()
      .timeoutSeconds(60)
      .argv()
      .slice(1),
    [
      "get",
      "rollout",
      "api",
      "--watch",
      "--no-color",
      "--timeout-seconds=60",
    ],
  );
  assertThrows(
    () => new ArgoRolloutsGetRolloutSettings().argv(),
    Error,
    "ArgoRolloutsTasks.getRollout: .name() is required.",
  );
});

Deno.test("getExperiment: bare and every flag", () => {
  assertEquals(
    new ArgoRolloutsGetExperimentSettings().name("exp").argv().slice(1),
    ["get", "experiment", "exp"],
  );
  assertEquals(
    new ArgoRolloutsGetExperimentSettings().name("exp").watch().noColor()
      .argv().slice(1),
    ["get", "experiment", "exp", "--watch", "--no-color"],
  );
  assertThrows(
    () => new ArgoRolloutsGetExperimentSettings().argv(),
    Error,
    "ArgoRolloutsTasks.getExperiment: .name() is required.",
  );
});

Deno.test("listRollouts: bare and every flag", () => {
  assertEquals(
    new ArgoRolloutsListRolloutsSettings().argv().slice(1),
    ["list", "rollouts"],
  );
  assertEquals(
    new ArgoRolloutsListRolloutsSettings()
      .namespace("prod")
      .allNamespaces()
      .name("api")
      .timestamps()
      .watch()
      .argv()
      .slice(1),
    [
      "list",
      "rollouts",
      "--namespace",
      "prod",
      "--all-namespaces",
      "--name",
      "api",
      "--timestamps",
      "--watch",
    ],
  );
});

Deno.test("listExperiments: bare and every flag", () => {
  assertEquals(
    new ArgoRolloutsListExperimentsSettings().argv().slice(1),
    ["list", "experiments"],
  );
  assertEquals(
    new ArgoRolloutsListExperimentsSettings().allNamespaces().watch().argv()
      .slice(1),
    ["list", "experiments", "--all-namespaces", "--watch"],
  );
});

Deno.test("version: full and short", () => {
  assertEquals(new ArgoRolloutsVersionSettings().argv().slice(1), ["version"]);
  assertEquals(
    new ArgoRolloutsVersionSettings().short().argv().slice(1),
    ["version", "--short"],
  );
});
