// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { GitWorktreeSettings, parseWorktreeList } from "../src/worktree.ts";
import { GitTasks } from "../src/git.ts";

Deno.test("worktree add checks a path out, with or without a new branch", () => {
  assertEquals(new GitWorktreeSettings().add("../feature").argv(), [
    "git",
    "worktree",
    "add",
    "../feature",
  ]);
  // `-b` creates the branch; the path still comes last.
  assertEquals(
    new GitWorktreeSettings().add("../feature").branch("feature")
      .createBranch().argv(),
    ["git", "worktree", "add", "-b", "feature", "../feature"],
  );
  // Without `-b` the branch is the commit-ish, which git takes after the path.
  assertEquals(
    new GitWorktreeSettings().add("../hotfix").branch("release/1.2").argv(),
    ["git", "worktree", "add", "../hotfix", "release/1.2"],
  );
  assertEquals(
    new GitWorktreeSettings().add("../detached").detach().force().argv(),
    ["git", "worktree", "add", "--force", "--detach", "../detached"],
  );
});

Deno.test("a start point is where a created branch forks from", () => {
  assertEquals(
    new GitWorktreeSettings().add("../feature").branch("feature")
      .createBranch().startPoint("origin/main").argv(),
    ["git", "worktree", "add", "-b", "feature", "../feature", "origin/main"],
  );
  // Without one, the argv is what it was before the option existed: git falls
  // back to the parent checkout's HEAD.
  assertEquals(
    new GitWorktreeSettings().add("../feature").branch("feature")
      .createBranch().argv(),
    ["git", "worktree", "add", "-b", "feature", "../feature"],
  );
  // A detached checkout takes a commit-ish in the same position.
  assertEquals(
    new GitWorktreeSettings().add("../review").detach()
      .startPoint("origin/main").argv(),
    ["git", "worktree", "add", "--detach", "../review", "origin/main"],
  );
});

Deno.test("a branch and a start point without -b are refused, not silently merged", () => {
  assertThrows(
    () =>
      new GitWorktreeSettings().add("../feature").branch("feature")
        .startPoint("origin/main").argv(),
    Error,
    "both want the trailing commit-ish",
  );
});

Deno.test("worktree list, remove, and prune build their own argv", () => {
  assertEquals(new GitWorktreeSettings().list().argv(), [
    "git",
    "worktree",
    "list",
  ]);
  assertEquals(new GitWorktreeSettings().list().porcelain().argv(), [
    "git",
    "worktree",
    "list",
    "--porcelain",
  ]);
  assertEquals(new GitWorktreeSettings().remove("../feature").argv(), [
    "git",
    "worktree",
    "remove",
    "../feature",
  ]);
  // A dirty worktree needs `--force`; git refuses it otherwise.
  assertEquals(
    new GitWorktreeSettings().remove("../feature").force().argv(),
    ["git", "worktree", "remove", "--force", "../feature"],
  );
  assertEquals(new GitWorktreeSettings().prune().argv(), [
    "git",
    "worktree",
    "prune",
  ]);
  // The global options apply here as they do to every other subcommand.
  assertEquals(new GitWorktreeSettings().dir("repo").prune().argv(), [
    "git",
    "-C",
    "repo",
    "worktree",
    "prune",
  ]);
});

Deno.test("a worktree call with no subcommand says which ones exist", () => {
  assertThrows(
    () => new GitWorktreeSettings().argv(),
    Error,
    "no subcommand",
  );
});

Deno.test("createBranch without a name is refused rather than sent to git", () => {
  assertThrows(
    () => new GitWorktreeSettings().add("../feature").createBranch().argv(),
    Error,
    ".createBranch() needs the name to create",
  );
});

Deno.test("parseWorktreeList reads paths, heads, branches, and flags", () => {
  const stdout = [
    "worktree /repo",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/master",
    "",
    "worktree /repo/../feature",
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/feature",
    "locked",
    "",
    "worktree /repo/../review",
    "HEAD 3333333333333333333333333333333333333333",
    "detached",
    "",
  ].join("\n");

  assertEquals(parseWorktreeList(stdout), [
    {
      path: "/repo",
      head: "1111111111111111111111111111111111111111",
      branch: "master",
      bare: false,
      detached: false,
      locked: false,
    },
    {
      path: "/repo/../feature",
      head: "2222222222222222222222222222222222222222",
      branch: "feature",
      bare: false,
      detached: false,
      locked: true,
    },
    {
      path: "/repo/../review",
      head: "3333333333333333333333333333333333333333",
      bare: false,
      detached: true,
      locked: false,
    },
  ]);
});

Deno.test("parseWorktreeList handles the bare entry, CRLF, and a missing final blank line", () => {
  const stdout = "worktree /repo.git\r\nbare\r\n\r\nworktree /repo\r\n" +
    "HEAD 4444444444444444444444444444444444444444\r\n" +
    "branch refs/heads/main\r\nsomething-new value\r\n";

  assertEquals(parseWorktreeList(stdout), [
    { path: "/repo.git", bare: true, detached: false, locked: false },
    {
      path: "/repo",
      head: "4444444444444444444444444444444444444444",
      branch: "main",
      bare: false,
      detached: false,
      locked: false,
    },
  ]);
});

Deno.test("parseWorktreeList yields nothing for empty or headless output", () => {
  assertEquals(parseWorktreeList(""), []);
  // An attribute with no `worktree` line above it belongs to no entry.
  assertEquals(parseWorktreeList("bare\ndetached\n"), []);
});

Deno.test("a branch ref outside refs/heads keeps its full name", () => {
  assertEquals(
    parseWorktreeList("worktree /repo\nbranch refs/remotes/origin/main\n"),
    [{
      path: "/repo",
      branch: "refs/remotes/origin/main",
      bare: false,
      detached: false,
      locked: false,
    }],
  );
});

Deno.test("both worktree tasks reach execution", async () => {
  await assertRejects(
    () => GitTasks.worktree((s) => missingTool(s.prune())),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GitTasks.worktreeList((s) => missingTool(s)),
    ToolNotFoundError,
  );
});

Deno.test("the worktree wrapper conforms to the tool contract", async () => {
  await assertWrapperConformance(
    () => new GitWorktreeSettings().prune(),
    "git",
    {
      resolution: "path",
    },
  );
});
