// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GhWorkflowDisableSettings,
  GhWorkflowEnableSettings,
  GhWorkflowListSettings,
  GhWorkflowRunSettings,
  GhWorkflowViewSettings,
  WORKFLOW_LIST_FIELDS,
} from "../mod.ts";
import { parseWorkflows } from "../src/workflow_command.ts";

Deno.test("workflow list renders its flags", () => {
  assertEquals(
    new GhWorkflowListSettings().repo("acme/app").all().limit(100).json("name")
      .jq(".[].name").argv().slice(1),
    [
      "workflow",
      "list",
      "--repo",
      "acme/app",
      "--all",
      "--limit",
      "100",
      "--json",
      "name",
      "--jq",
      ".[].name",
    ],
  );
});

Deno.test("every workflow command names its workflow", () => {
  for (
    const [task, build] of [
      ["workflowView", () => new GhWorkflowViewSettings().argv()],
      ["workflowRun", () => new GhWorkflowRunSettings().argv()],
      ["workflowEnable", () => new GhWorkflowEnableSettings().argv()],
      ["workflowDisable", () => new GhWorkflowDisableSettings().argv()],
    ] as const
  ) {
    assertThrows(build, Error, `GhTasks.${task}: .workflow(...) is required`);
  }
});

Deno.test("workflow view carries no read flags, because gh gives it none", () => {
  // gh gives `workflow view` --yaml and --web but no --json, so the wrapper
  // must not offer the read flags it would reject.
  assertEquals("json" in new GhWorkflowViewSettings(), false);
  assertEquals("jq" in new GhWorkflowViewSettings(), false);
  assertEquals("json" in new GhWorkflowListSettings(), true);
  assertEquals(
    new GhWorkflowViewSettings().workflow("ci.yml").ref("master").yaml().web()
      .argv().slice(1),
    ["workflow", "view", "ci.yml", "--ref", "master", "--yaml", "--web"],
  );
});

Deno.test("workflow run renders its inputs", () => {
  assertEquals(
    new GhWorkflowRunSettings()
      .workflow("e2e.yml")
      .ref("master")
      .field("environment", "staging")
      .field("retries", 3)
      .rawField("prefix", "@release")
      .argv()
      .slice(1),
    [
      "workflow",
      "run",
      "e2e.yml",
      "--ref",
      "master",
      "--field",
      "environment=staging",
      "--field",
      "retries=3",
      "--raw-field",
      "prefix=@release",
    ],
  );
  assertEquals(
    new GhWorkflowRunSettings().workflow(12345).jsonInput().argv().slice(1),
    ["workflow", "run", "12345", "--json"],
  );
  // gh reads every input from stdin under --json, so the named ones would be
  // silently dropped.
  assertThrows(
    () =>
      new GhWorkflowRunSettings().workflow("e2e.yml").jsonInput().field(
        "env",
        "staging",
      ).argv(),
    Error,
    "GhTasks.workflowRun: .jsonInput() reads every input",
  );
});

Deno.test("workflow enable and disable take the workflow and nothing else", () => {
  assertEquals(
    new GhWorkflowEnableSettings().workflow("nightly.yml").argv().slice(1),
    ["workflow", "enable", "nightly.yml"],
  );
  assertEquals(
    new GhWorkflowDisableSettings().workflow("nightly.yml").repo("acme/app")
      .argv().slice(1),
    ["workflow", "disable", "nightly.yml", "--repo", "acme/app"],
  );
});

Deno.test("parseWorkflows reads gh's JSON array", () => {
  const stdout = JSON.stringify([
    { id: 1234, name: "CI", path: ".github/workflows/ci.yml", state: "active" },
  ]);
  assertEquals(parseWorkflows(stdout), [{
    id: 1234,
    name: "CI",
    path: ".github/workflows/ci.yml",
    state: "active",
  }]);
});

Deno.test("parseWorkflows treats anything but an array of objects as empty", () => {
  assertEquals(parseWorkflows("[]"), []);
  assertEquals(parseWorkflows("no workflows found"), []);
  assertEquals(parseWorkflows('{"id":1}'), []);
  assertEquals(parseWorkflows('[{"id":"1234"}]'), [{}]);
});

Deno.test("the pinned workflow field set is what the entry documents", () => {
  assertEquals(WORKFLOW_LIST_FIELDS.includes("path"), true);
  assertEquals(WORKFLOW_LIST_FIELDS.includes("state"), true);
  assertEquals(WORKFLOW_LIST_FIELDS.length, 4);
});
