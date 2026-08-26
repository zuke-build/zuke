// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  GitDefaultBranchSettings,
  parseSymbolicRef,
  parseSymrefListing,
} from "../src/default_branch.ts";
import { GitTasks } from "../src/git.ts";

Deno.test("the local read asks for the remote's HEAD ref", () => {
  assertEquals(new GitDefaultBranchSettings().argv(), [
    "git",
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  assertEquals(
    new GitDefaultBranchSettings().remote("upstream").dir("repo").argv(),
    [
      "git",
      "-C",
      "repo",
      "symbolic-ref",
      "--quiet",
      "--short",
      "refs/remotes/upstream/HEAD",
    ],
  );
});

Deno.test("the fallback asks the remote itself", () => {
  const settings = new GitDefaultBranchSettings().remote("upstream");
  settings.askRemote_ = true;
  assertEquals(settings.argv(), [
    "git",
    "ls-remote",
    "--symref",
    "upstream",
    "HEAD",
  ]);
});

Deno.test("parseSymbolicRef takes the branch out of either ref form", () => {
  assertEquals(parseSymbolicRef("origin/main\n", "origin"), "main");
  // A branch with slashes in its name survives intact.
  assertEquals(
    parseSymbolicRef("origin/release/1.x\n", "origin"),
    "release/1.x",
  );
  // An older git can still print the full ref.
  assertEquals(
    parseSymbolicRef("refs/remotes/origin/master\n", "origin"),
    "master",
  );
  // Another remote's ref is not this remote's answer.
  assertEquals(parseSymbolicRef("upstream/main\n", "origin"), undefined);
  assertEquals(parseSymbolicRef("", "origin"), undefined);
});

Deno.test("parseSymrefListing reads the symref line of the remote listing", () => {
  const stdout = "ref: refs/heads/main\tHEAD\n" +
    "1111111111111111111111111111111111111111\tHEAD\n";
  assertEquals(parseSymrefListing(stdout), "main");
  // A remote whose HEAD is detached reports no symref at all.
  assertEquals(
    parseSymrefListing("1111111111111111111111111111111111111111\tHEAD\n"),
    undefined,
  );
  assertEquals(parseSymrefListing(""), undefined);
});

Deno.test("defaultBranch reaches execution", async () => {
  await assertRejects(
    () => GitTasks.defaultBranch((s) => missingTool(s)),
    ToolNotFoundError,
  );
});

Deno.test("the default-branch wrapper conforms to the tool contract", async () => {
  await assertWrapperConformance(
    () => new GitDefaultBranchSettings(),
    "git",
    { resolution: "path" },
  );
});
