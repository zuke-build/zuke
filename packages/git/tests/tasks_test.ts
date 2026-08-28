// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  GitApplySettings,
  GitDiffSettings,
  GitLogSettings,
  GitMergeSettings,
  GitTasks,
} from "../mod.ts";

/**
 * Every task, with the minimum configuration its settings demand, pointed at a
 * binary that cannot exist. Each entry proves that task actually reaches
 * execution — an argv test alone would pass for a task wired to the wrong
 * settings class, or to none.
 */
const TASKS: Array<[string, () => Promise<unknown>]> = [
  ["rm", () => GitTasks.rm((s) => missingTool(s).paths("a.ts"))],
  [
    "mv",
    () =>
      GitTasks.mv((s) => missingTool(s).sources("a.ts").destination("b.ts")),
  ],
  ["restore", () => GitTasks.restore((s) => missingTool(s).paths("a.ts"))],
  ["clean", () => GitTasks.clean((s) => missingTool(s).force())],
  ["switch", () => GitTasks.switch((s) => missingTool(s).branch("main"))],
  ["remote", () => GitTasks.remote((s) => missingTool(s))],
  ["remoteList", () => GitTasks.remoteList((s) => missingTool(s))],
  ["lsRemote", () => GitTasks.lsRemote((s) => missingTool(s))],
  ["log", () => GitTasks.log((s) => missingTool(s))],
  ["show", () => GitTasks.show((s) => missingTool(s).object("HEAD"))],
  ["diff", () => GitTasks.diff((s) => missingTool(s))],
  ["lsFiles", () => GitTasks.lsFiles((s) => missingTool(s))],
  ["revParse", () => GitTasks.revParse((s) => missingTool(s).rev("HEAD"))],
  ["describe", () => GitTasks.describe((s) => missingTool(s).tags())],
  ["merge", () => GitTasks.merge((s) => missingTool(s).refs("main"))],
  [
    "rebase",
    () => GitTasks.rebase((s) => missingTool(s).upstream("origin/main")),
  ],
  [
    "cherryPick",
    () => GitTasks.cherryPick((s) => missingTool(s).commits("abc123")),
  ],
  ["revert", () => GitTasks.revert((s) => missingTool(s).commits("abc123"))],
  ["reset", () => GitTasks.reset((s) => missingTool(s).hard())],
  ["stash", () => GitTasks.stash((s) => missingTool(s).push())],
  ["config", () => GitTasks.config((s) => missingTool(s).list())],
  ["submodule", () => GitTasks.submodule((s) => missingTool(s).update())],
  ["archive", () => GitTasks.archive((s) => missingTool(s).treeish("HEAD"))],
  ["apply", () => GitTasks.apply((s) => missingTool(s).patches("fix.patch"))],
];

for (const [name, invoke] of TASKS) {
  Deno.test(`GitTasks.${name} reaches execution`, async () => {
    await assertRejects(invoke, ToolNotFoundError);
  });
}

Deno.test("the new settings classes conform to the wrapper contract", async () => {
  // One per module family: a reader, a writer, a sequencer, and a patcher all
  // resolve `git` from PATH and report a missing binary the same way.
  for (
    const make of [
      () => new GitLogSettings(),
      () => new GitDiffSettings(),
      () => new GitMergeSettings().refs("main"),
      () => new GitApplySettings(),
    ]
  ) {
    await assertWrapperConformance(make, "git", { resolution: "path" });
  }
});
