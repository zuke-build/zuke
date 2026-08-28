// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { GhTasks } from "../mod.ts";
import { GhPrListSettings } from "../src/pr.ts";
import { GhIssueListSettings } from "../src/issue.ts";
import { GhReleaseListSettings } from "../src/release.ts";

Deno.test("the typed command groups conform to the gh wrapper's contract", async () => {
  for (
    const make of [
      () => new GhPrListSettings(),
      () => new GhIssueListSettings(),
      () => new GhReleaseListSettings(),
    ]
  ) {
    await assertWrapperConformance(make, "gh", { resolution: "path" });
  }
});

Deno.test("every gh pr task reaches execution", async () => {
  await assertRejects(
    () => GhTasks.prCreate((s) => missingTool(s.title("t").body("b"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.prList((s) => missingTool(s.state("open"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.prListEntries((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.prView((s) => missingTool(s.selector(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.prChecks((s) => missingTool(s.selector(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.prMerge((s) => missingTool(s.selector(1).squash())),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.prComment((s) => missingTool(s.selector(1).body("b"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.prEdit((s) => missingTool(s.selector(1).title("t"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.prClose((s) => missingTool(s.selector(1))),
    ToolNotFoundError,
  );
});

Deno.test("every gh issue task reaches execution", async () => {
  await assertRejects(
    () => GhTasks.issueCreate((s) => missingTool(s.title("t"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.issueList((s) => missingTool(s.state("open"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.issueListEntries((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.issueView((s) => missingTool(s.selector(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.issueComment((s) => missingTool(s.selector(1).body("b"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.issueClose((s) => missingTool(s.selector(1))),
    ToolNotFoundError,
  );
});

Deno.test("every gh release task reaches execution", async () => {
  await assertRejects(
    () => GhTasks.releaseCreate((s) => missingTool(s.tag("v1"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.releaseList((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.releaseListEntries((s) => missingTool(s.limit(1))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.releaseView((s) => missingTool(s.tag("v1"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.releaseUpload((s) => missingTool(s.tag("v1").files("a.tgz"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.releaseDownload((s) => missingTool(s.tag("v1"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.releaseEdit((s) => missingTool(s.tag("v1").title("t"))),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GhTasks.releaseDelete((s) => missingTool(s.tag("v1").yes())),
    ToolNotFoundError,
  );
});
