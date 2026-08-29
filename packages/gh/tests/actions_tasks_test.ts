// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  CACHE_LIST_FIELDS,
  GhTasks,
  LABEL_LIST_FIELDS,
  REPO_LIST_FIELDS,
  RUN_LIST_FIELDS,
  SECRET_LIST_FIELDS,
  VARIABLE_LIST_FIELDS,
  WORKFLOW_LIST_FIELDS,
} from "../mod.ts";
import { GhRunListSettings } from "../src/actions_run.ts";
import { GhWorkflowListSettings } from "../src/workflow_command.ts";
import { GhSecretListSettings } from "../src/secret.ts";
import { GhVariableListSettings } from "../src/variable.ts";
import { GhCacheListSettings } from "../src/cache.ts";
import { GhLabelListSettings } from "../src/label.ts";
import { GhRepoListSettings } from "../src/repo.ts";

Deno.test("the new command groups conform to the gh wrapper's contract", async () => {
  for (
    const make of [
      () => new GhRunListSettings(),
      () => new GhWorkflowListSettings(),
      () => new GhSecretListSettings(),
      () => new GhVariableListSettings(),
      () => new GhCacheListSettings(),
      () => new GhLabelListSettings(),
      () => new GhRepoListSettings(),
    ]
  ) {
    await assertWrapperConformance(make, "gh", { resolution: "path" });
  }
});

Deno.test("every gh run and workflow task reaches execution", async () => {
  await assertRejects(
    () => GhTasks.runList((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.runListEntries((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.runView((s) => missingTool(s.selector(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.runRerun((s) => missingTool(s.selector(1).failed())),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.runCancel((s) => missingTool(s.selector(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.runDelete((s) => missingTool(s.selector(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.runDownload((s) => missingTool(s.selector(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.runWatch((s) => missingTool(s.selector(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.workflowList((s) => missingTool(s.all())),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.workflowListEntries((s) => missingTool(s.all())),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.workflowView((s) => missingTool(s.workflow("ci.yml"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.workflowRun((s) => missingTool(s.workflow("ci.yml"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.workflowEnable((s) => missingTool(s.workflow("ci.yml"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.workflowDisable((s) => missingTool(s.workflow("ci.yml"))),
    ToolNotFoundError,
  );
});

Deno.test("every gh secret, variable and cache task reaches execution", async () => {
  await assertRejects(
    () => GhTasks.secretSet((s) => missingTool(s.name("A").body("b"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.secretList((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.secretListEntries((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.secretDelete((s) => missingTool(s.name("A"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.variableSet((s) => missingTool(s.name("A").body("b"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.variableGet((s) => missingTool(s.name("A"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.variableValue((s) => missingTool(s.name("A"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.variableList((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.variableListEntries((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.variableDelete((s) => missingTool(s.name("A"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.cacheList((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.cacheListEntries((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.cacheDelete((s) => missingTool(s.all())),
    ToolNotFoundError,
  );
});

Deno.test("every gh repo and label task reaches execution", async () => {
  await assertRejects(
    () => GhTasks.repoClone((s) => missingTool(s.repository("acme/app"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      GhTasks.repoCreate((s) =>
        missingTool(s.name("app").visibility("private"))
      ),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.repoView((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.repoList((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.repoListEntries((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.repoFork((s) => missingTool(s.repository("acme/app"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.repoSync((s) => missingTool(s.source("acme/app"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.repoEdit((s) => missingTool(s.description("x"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.repoRename((s) => missingTool(s.newName("app2").yes())),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.repoArchive((s) => missingTool(s.repository("a/b").yes())),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.repoDelete((s) => missingTool(s.repository("a/b").yes())),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.repoSetDefault((s) => missingTool(s.repository("a/b"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.labelList((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.labelListEntries((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.labelCreate((s) => missingTool(s.name("bug"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.labelEdit((s) => missingTool(s.name("bug"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.labelDelete((s) => missingTool(s.name("bug").yes())),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.labelClone((s) => missingTool(s.source("acme/template"))),
    ToolNotFoundError,
  );
});

Deno.test("each new reader pins its own field set into the argv it runs", async () => {
  // Asserting the constants alone would not catch a reader wired to the wrong
  // one, so capture the settings each reader configures and read back the
  // argv it was about to spawn.
  const seen: Array<[string, string[]]> = [];

  let run: GhRunListSettings | undefined;
  await assertRejects(
    () =>
      GhTasks.runListEntries((s) => {
        run = s;
        return missingTool(s);
      }),
    ToolNotFoundError,
  );
  if (run !== undefined) seen.push(["run", run.argv().slice(1)]);

  let workflow: GhWorkflowListSettings | undefined;
  await assertRejects(
    () =>
      GhTasks.workflowListEntries((s) => {
        workflow = s;
        return missingTool(s);
      }),
    ToolNotFoundError,
  );
  if (workflow !== undefined) {
    seen.push(["workflow", workflow.argv().slice(1)]);
  }

  let secret: GhSecretListSettings | undefined;
  await assertRejects(
    () =>
      GhTasks.secretListEntries((s) => {
        secret = s;
        return missingTool(s);
      }),
    ToolNotFoundError,
  );
  if (secret !== undefined) seen.push(["secret", secret.argv().slice(1)]);

  let variable: GhVariableListSettings | undefined;
  await assertRejects(
    () =>
      GhTasks.variableListEntries((s) => {
        variable = s;
        return missingTool(s);
      }),
    ToolNotFoundError,
  );
  if (variable !== undefined) seen.push(["variable", variable.argv().slice(1)]);

  let cache: GhCacheListSettings | undefined;
  await assertRejects(
    () =>
      GhTasks.cacheListEntries((s) => {
        cache = s;
        return missingTool(s);
      }),
    ToolNotFoundError,
  );
  if (cache !== undefined) seen.push(["cache", cache.argv().slice(1)]);

  let label: GhLabelListSettings | undefined;
  await assertRejects(
    () =>
      GhTasks.labelListEntries((s) => {
        label = s;
        return missingTool(s);
      }),
    ToolNotFoundError,
  );
  if (label !== undefined) seen.push(["label", label.argv().slice(1)]);

  let repo: GhRepoListSettings | undefined;
  await assertRejects(
    () =>
      GhTasks.repoListEntries((s) => {
        repo = s;
        return missingTool(s);
      }),
    ToolNotFoundError,
  );
  if (repo !== undefined) seen.push(["repo", repo.argv().slice(1)]);

  assertEquals(seen, [
    ["run", ["run", "list", "--json", RUN_LIST_FIELDS.join(",")]],
    [
      "workflow",
      ["workflow", "list", "--json", WORKFLOW_LIST_FIELDS.join(",")],
    ],
    ["secret", ["secret", "list", "--json", SECRET_LIST_FIELDS.join(",")]],
    [
      "variable",
      ["variable", "list", "--json", VARIABLE_LIST_FIELDS.join(",")],
    ],
    ["cache", ["cache", "list", "--json", CACHE_LIST_FIELDS.join(",")]],
    ["label", ["label", "list", "--json", LABEL_LIST_FIELDS.join(",")]],
    ["repo", ["repo", "list", "--json", REPO_LIST_FIELDS.join(",")]],
  ]);
});
