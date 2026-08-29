// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  GhTasks,
  ISSUE_LIST_FIELDS,
  PR_LIST_FIELDS,
  RELEASE_LIST_FIELDS,
} from "../mod.ts";
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

Deno.test("each reader pins its own field set into the argv it runs", async () => {
  // gh requires --json fields by name, and each reader's parse only makes
  // sense against the set its entry documents. Asserting the constants alone
  // would not catch a reader wired to the wrong one, so capture the settings
  // the reader configures and read back the argv it was about to spawn.
  const runs: Array<[string, string[], readonly string[], string[]]> = [];

  let pr: GhPrListSettings | undefined;
  await assertRejects(
    () =>
      GhTasks.prListEntries((s) => {
        pr = s;
        return missingTool(s);
      }),
    ToolNotFoundError,
  );
  if (pr !== undefined) {
    runs.push(["prListEntries", pr.argv().slice(1), PR_LIST_FIELDS, [
      "pr",
      "list",
    ]]);
  }

  let issue: GhIssueListSettings | undefined;
  await assertRejects(
    () =>
      GhTasks.issueListEntries((s) => {
        issue = s;
        return missingTool(s);
      }),
    ToolNotFoundError,
  );
  if (issue !== undefined) {
    runs.push(["issueListEntries", issue.argv().slice(1), ISSUE_LIST_FIELDS, [
      "issue",
      "list",
    ]]);
  }

  let release: GhReleaseListSettings | undefined;
  await assertRejects(
    () =>
      GhTasks.releaseListEntries((s) => {
        release = s;
        return missingTool(s);
      }),
    ToolNotFoundError,
  );
  if (release !== undefined) {
    runs.push([
      "releaseListEntries",
      release.argv().slice(1),
      RELEASE_LIST_FIELDS,
      ["release", "list"],
    ]);
  }

  assertEquals(runs.length, 3);
  for (const [task, argv, fields, path] of runs) {
    assertEquals(argv, [...path, "--json", fields.join(",")], task);
  }
});
