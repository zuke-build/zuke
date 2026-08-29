// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GhRunCancelSettings,
  GhRunDeleteSettings,
  GhRunDownloadSettings,
  GhRunListSettings,
  GhRunRerunSettings,
  GhRunViewSettings,
  GhRunWatchSettings,
  RUN_LIST_FIELDS,
} from "../mod.ts";
import { parseRuns } from "../src/actions_run.ts";

Deno.test("run list renders every filter", () => {
  assertEquals(
    new GhRunListSettings()
      .repo("acme/app")
      .all()
      .branch("master")
      .commit("abc123")
      .created(">=2026-08-01")
      .event("push")
      .status("failure")
      .user("someone")
      .workflow("ci.yml")
      .limit(20)
      .json("databaseId")
      .argv()
      .slice(1),
    [
      "run",
      "list",
      "--repo",
      "acme/app",
      "--all",
      "--branch",
      "master",
      "--commit",
      "abc123",
      "--created",
      ">=2026-08-01",
      "--event",
      "push",
      "--status",
      "failure",
      "--user",
      "someone",
      "--workflow",
      "ci.yml",
      "--limit",
      "20",
      "--json",
      "databaseId",
    ],
  );
  assertEquals(new GhRunListSettings().argv().slice(1), ["run", "list"]);
});

Deno.test("every run command names its run", () => {
  // gh shows a picker without a run id, and a build has no one to answer it.
  for (
    const [task, build] of [
      ["runView", () => new GhRunViewSettings().argv()],
      ["runRerun", () => new GhRunRerunSettings().argv()],
      ["runCancel", () => new GhRunCancelSettings().argv()],
      ["runDelete", () => new GhRunDeleteSettings().argv()],
      ["runDownload", () => new GhRunDownloadSettings().argv()],
      ["runWatch", () => new GhRunWatchSettings().argv()],
    ] as const
  ) {
    assertThrows(build, Error, `GhTasks.${task}: .selector(...) is required`);
  }
});

Deno.test("run view renders its log and job flags", () => {
  assertEquals(
    new GhRunViewSettings().selector(123).attempt(2).job(456).logFailed()
      .exitStatus().verbose().json("conclusion").web().argv().slice(1),
    [
      "run",
      "view",
      "123",
      "--attempt",
      "2",
      "--job",
      "456",
      "--log-failed",
      "--exit-status",
      "--verbose",
      "--json",
      "conclusion",
      "--web",
    ],
  );
  assertEquals(
    new GhRunViewSettings().selector(123).log().argv().slice(1),
    ["run", "view", "123", "--log"],
  );
  // gh honours whichever it sees last, so a build asking for both would get a
  // log it did not choose.
  assertThrows(
    () => new GhRunViewSettings().selector(1).log().logFailed().argv(),
    Error,
    "GhTasks.runView: .log() prints every step",
  );
});

Deno.test("run rerun renders its scope, and refuses two of them", () => {
  assertEquals(
    new GhRunRerunSettings().selector(123).failed().debug().argv().slice(1),
    ["run", "rerun", "123", "--failed", "--debug"],
  );
  assertEquals(
    new GhRunRerunSettings().selector(123).job(456).argv().slice(1),
    ["run", "rerun", "123", "--job", "456"],
  );
  assertThrows(
    () => new GhRunRerunSettings().selector(1).failed().job(2).argv(),
    Error,
    "GhTasks.runRerun: .failed() reruns every failed job",
  );
});

Deno.test("run cancel, delete, download and watch render their flags", () => {
  assertEquals(
    new GhRunCancelSettings().selector(123).force().argv().slice(1),
    ["run", "cancel", "123", "--force"],
  );
  assertEquals(
    new GhRunDeleteSettings().selector(123).argv().slice(1),
    ["run", "delete", "123"],
  );
  assertEquals(
    new GhRunDownloadSettings().selector(123).name("coverage", "logs")
      .pattern("*.xml").dir("artifacts").argv().slice(1),
    [
      "run",
      "download",
      "123",
      "--name",
      "coverage",
      "--name",
      "logs",
      "--pattern",
      "*.xml",
      "--dir",
      "artifacts",
    ],
  );
  assertEquals(
    new GhRunWatchSettings().selector(123).compact().exitStatus().interval(5)
      .argv().slice(1),
    ["run", "watch", "123", "--compact", "--exit-status", "--interval", "5"],
  );
});

Deno.test("parseRuns reads gh's JSON array", () => {
  const stdout = JSON.stringify([
    {
      databaseId: 33197307624,
      number: 42,
      displayTitle: "feat(gh): typed run tasks",
      workflowName: "CI",
      headBranch: "feature",
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      url: "https://github.com/o/r/actions/runs/33197307624",
      createdAt: "2026-08-29T10:00:00Z",
    },
  ]);
  assertEquals(parseRuns(stdout), [{
    databaseId: 33197307624,
    number: 42,
    displayTitle: "feat(gh): typed run tasks",
    workflowName: "CI",
    headBranch: "feature",
    event: "pull_request",
    status: "completed",
    conclusion: "failure",
    url: "https://github.com/o/r/actions/runs/33197307624",
    createdAt: "2026-08-29T10:00:00Z",
  }]);
  // A run still going has no conclusion, and the entry simply omits it.
  assertEquals(parseRuns('[{"databaseId":1,"status":"in_progress"}]'), [{
    databaseId: 1,
    status: "in_progress",
  }]);
});

Deno.test("parseRuns treats anything but an array of objects as empty", () => {
  assertEquals(parseRuns("[]"), []);
  assertEquals(parseRuns(""), []);
  assertEquals(parseRuns("no runs found"), []);
  assertEquals(parseRuns('{"databaseId":1}'), []);
  assertEquals(parseRuns("[123]"), []);
  // A field gh reports as the wrong type is not that field.
  assertEquals(parseRuns('[{"databaseId":"33197307624"}]'), [{}]);
});

Deno.test("the pinned run field set is what the entry documents", () => {
  assertEquals(RUN_LIST_FIELDS.includes("databaseId"), true);
  assertEquals(RUN_LIST_FIELDS.includes("conclusion"), true);
  assertEquals(RUN_LIST_FIELDS.length, 10);
});
