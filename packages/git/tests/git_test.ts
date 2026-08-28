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
import {
  GitAddSettings,
  GitBranchSettings,
  GitCheckoutSettings,
  GitCloneSettings,
  GitCommitSettings,
  GitFetchSettings,
  GitInitSettings,
  GitPullSettings,
  GitPushSettings,
  GitRunSettings,
  GitStatusSettings,
  GitSwitchSettings,
  GitTagSettings,
  GitTasks,
} from "../mod.ts";

Deno.test("the default binary is git and global options precede the subcommand", () => {
  assertEquals(new GitStatusSettings().argv(), ["git", "status"]);
  const argv = new GitStatusSettings()
    .dir("repo").config("user.name", "CI").short().argv();
  assertEquals(argv, [
    "git",
    "-C",
    "repo",
    "-c",
    "user.name=CI",
    "status",
    "--short",
  ]);
});

Deno.test("status: --porcelain and --branch render alongside --short", () => {
  assertEquals(
    new GitStatusSettings().porcelain().branch().argv(),
    ["git", "status", "--porcelain", "--branch"],
  );
});

Deno.test("init and clone render their options", () => {
  assertEquals(
    new GitInitSettings().bare().initialBranch("main").argv(),
    ["git", "init", "--bare", "-b", "main"],
  );
  assertEquals(
    new GitCloneSettings().repository("git@host:r.git").directory("r")
      .branch("main").depth(1).bare().argv(),
    [
      "git",
      "clone",
      "-b",
      "main",
      "--depth",
      "1",
      "--bare",
      "git@host:r.git",
      "r",
    ],
  );
  assertThrows(() => new GitCloneSettings().argv(), Error, ".repository()");
});

Deno.test("add and commit render their options", () => {
  assertEquals(new GitAddSettings().all().paths("src", "mod.ts").argv(), [
    "git",
    "add",
    "--all",
    "--",
    "src",
    "mod.ts",
  ]);
  assertEquals(new GitAddSettings().update().argv(), [
    "git",
    "add",
    "--update",
  ]);
  // A pathspec beginning with `-` goes after `--`, not parsed by git as a flag.
  assertEquals(new GitAddSettings().paths("-weird.txt").argv(), [
    "git",
    "add",
    "--",
    "-weird.txt",
  ]);
  assertEquals(
    new GitCommitSettings().all().amend().noEdit().allowEmpty()
      .message("msg").argv(),
    [
      "git",
      "commit",
      "--all",
      "--amend",
      "--no-edit",
      "--allow-empty",
      "-m",
      "msg",
    ],
  );
});

Deno.test("checkout requires a ref and supports -b/-f", () => {
  // `--force` precedes `-b`: `git checkout -b --force feature` makes git read
  // `--force` as the branch name and fails; `--force -b feature` is valid.
  assertEquals(
    new GitCheckoutSettings().create().force().ref("feature").argv(),
    ["git", "checkout", "--force", "-b", "feature"],
  );
  assertThrows(() => new GitCheckoutSettings().argv(), Error, ".ref()");
});

Deno.test("checkout restores paths with a `--` separator", () => {
  // Restore paths from the index (discard working-tree changes): no ref.
  assertEquals(
    new GitCheckoutSettings().paths("src/a.ts", "src/b.ts").argv(),
    ["git", "checkout", "--", "src/a.ts", "src/b.ts"],
  );
  // Restore a path from a ref — `--` keeps the path from being read as a branch.
  assertEquals(
    new GitCheckoutSettings().ref("origin/main").paths("src/a.ts").argv(),
    ["git", "checkout", "origin/main", "--", "src/a.ts"],
  );
  // .paths() alone satisfies the requirement (no ref needed).
  assertEquals(
    new GitCheckoutSettings().paths("x").argv(),
    ["git", "checkout", "--", "x"],
  );
  // -b creates a branch and cannot restore files.
  assertThrows(
    () => new GitCheckoutSettings().create().paths("x").argv(),
    Error,
    ".create() cannot be combined with .paths(",
  );
});

Deno.test("branch and tag render their options", () => {
  assertEquals(new GitBranchSettings().all().argv(), [
    "git",
    "branch",
    "--all",
  ]);
  assertEquals(
    new GitBranchSettings().deleteBranch(true).name("old").argv(),
    ["git", "branch", "-D", "old"],
  );
  assertEquals(
    new GitTagSettings().name("v1").message("Release").force().argv(),
    ["git", "tag", "--force", "-a", "-m", "Release", "v1"],
  );
  assertEquals(new GitTagSettings().deleteTag().name("v1").argv(), [
    "git",
    "tag",
    "--delete",
    "v1",
  ]);
});

Deno.test("push, pull, and fetch render their options", () => {
  assertEquals(
    new GitPushSettings().setUpstream().tags().forceWithLease()
      .remote("origin").ref("main").argv(),
    [
      "git",
      "push",
      "--set-upstream",
      "--tags",
      "--force-with-lease",
      "origin",
      "main",
    ],
  );
  assertEquals(
    new GitPullSettings().rebase().ffOnly().remote("origin").ref("main").argv(),
    ["git", "pull", "--rebase", "--ff-only", "origin", "main"],
  );
  assertEquals(
    new GitFetchSettings().all().tags().prune().remote("origin").argv(),
    ["git", "fetch", "--all", "--tags", "--prune", "origin"],
  );
});

Deno.test("fetch: a shallow refspec fetch without tags renders in git's own order", () => {
  // What a CI job needs to diff against a base branch it never cloned: one
  // commit of the base, no tags, and a refspec that also updates the
  // remote-tracking ref so `origin/master` resolves afterwards.
  assertEquals(
    new GitFetchSettings()
      .noTags()
      .depth(1)
      .remote("origin")
      // Forced, because a shallow fetch is not a fast-forward of the history
      // already in the checkout and git would otherwise refuse the update.
      .refspec("+master:refs/remotes/origin/master")
      .argv(),
    [
      "git",
      "fetch",
      "--no-tags",
      "--depth",
      "1",
      "origin",
      "+master:refs/remotes/origin/master",
    ],
  );
});

Deno.test("fetch: refspecs are repeatable and always follow the remote", () => {
  assertEquals(
    new GitFetchSettings().remote("upstream").refspec("main").refspec("dev")
      .argv(),
    ["git", "fetch", "upstream", "main", "dev"],
  );
});

Deno.test("push: --delete renders the remote ref removal", () => {
  assertEquals(
    new GitPushSettings().deleteRef().remote("origin").ref("stale").argv(),
    ["git", "push", "--delete", "origin", "stale"],
  );
});

Deno.test("run executes an arbitrary command", () => {
  assertEquals(
    new GitRunSettings().command("rev-parse", "--short", "HEAD").argv(),
    ["git", "rev-parse", "--short", "HEAD"],
  );
});

Deno.test("GitTasks.status reaches execution", async () => {
  await assertRejects(() => GitTasks.status(missingTool), ToolNotFoundError);
});

Deno.test("GitTasks.init reaches execution", async () => {
  await assertRejects(() => GitTasks.init(missingTool), ToolNotFoundError);
});

Deno.test("GitTasks.clone reaches execution", async () => {
  await assertRejects(
    () => GitTasks.clone((s) => missingTool(s).repository("git@host:r.git")),
    ToolNotFoundError,
  );
});

Deno.test("GitTasks.add reaches execution", async () => {
  await assertRejects(() => GitTasks.add(missingTool), ToolNotFoundError);
});

Deno.test("GitTasks.commit reaches execution", async () => {
  await assertRejects(
    () => GitTasks.commit((s) => missingTool(s).message("msg")),
    ToolNotFoundError,
  );
});

Deno.test("GitTasks.checkout reaches execution", async () => {
  await assertRejects(
    () => GitTasks.checkout((s) => missingTool(s).ref("main")),
    ToolNotFoundError,
  );
});

Deno.test("GitTasks.branch reaches execution", async () => {
  await assertRejects(() => GitTasks.branch(missingTool), ToolNotFoundError);
});

Deno.test("GitTasks.tag reaches execution", async () => {
  await assertRejects(() => GitTasks.tag(missingTool), ToolNotFoundError);
});

Deno.test("GitTasks.push reaches execution", async () => {
  await assertRejects(() => GitTasks.push(missingTool), ToolNotFoundError);
});

Deno.test("GitTasks.pull reaches execution", async () => {
  await assertRejects(() => GitTasks.pull(missingTool), ToolNotFoundError);
});

Deno.test("GitTasks.fetch reaches execution", async () => {
  await assertRejects(() => GitTasks.fetch(missingTool), ToolNotFoundError);
});

Deno.test("GitTasks.run reaches execution", async () => {
  await assertRejects(
    () => GitTasks.run((s) => missingTool(s).command("rev-parse", "HEAD")),
    ToolNotFoundError,
  );
});

Deno.test("git: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(() => new GitInitSettings(), "git", {
    resolution: "path",
  });
});

Deno.test("clone renders the flags a CI checkout needs", () => {
  assertEquals(
    new GitCloneSettings().repository("git@host:r.git").singleBranch()
      .filter("blob:none").recurseSubmodules().argv(),
    [
      "git",
      "clone",
      "--single-branch",
      "--filter=blob:none",
      "--recurse-submodules",
      "git@host:r.git",
    ],
  );
});

Deno.test("commit renders the author, hook skip, and pathspecs", () => {
  assertEquals(
    new GitCommitSettings().noVerify().author("CI <ci@example.test>")
      .message("chore: regen").paths("docs").argv(),
    [
      "git",
      "commit",
      "--no-verify",
      "--author=CI <ci@example.test>",
      "-m",
      "chore: regen",
      "--",
      "docs",
    ],
  );
});

Deno.test("checkout can detach at a ref", () => {
  assertEquals(
    new GitCheckoutSettings().detach().ref("v1.2.3").argv(),
    ["git", "checkout", "--detach", "v1.2.3"],
  );
});

Deno.test("switch renders creation, tracking, and the start point", () => {
  assertEquals(
    new GitSwitchSettings().create().branch("feature").startPoint("origin/main")
      .argv(),
    ["git", "switch", "-c", "feature", "origin/main"],
  );
  assertEquals(
    new GitSwitchSettings().force().forceCreate().track("direct")
      .branch("feature").argv(),
    ["git", "switch", "--force", "--track=direct", "-C", "feature"],
  );
  assertEquals(
    new GitSwitchSettings().detach().branch("v1.2.3").argv(),
    ["git", "switch", "--detach", "v1.2.3"],
  );
  // `git switch --detach` alone detaches at the current HEAD, so only that
  // form stands without a branch.
  assertEquals(new GitSwitchSettings().detach().argv(), [
    "git",
    "switch",
    "--detach",
  ]);
  assertThrows(() => new GitSwitchSettings().argv(), Error, ".branch(...)");
  // -c and -C both create it; git takes one.
  assertThrows(
    () => new GitSwitchSettings().create().forceCreate().branch("x").argv(),
    Error,
    "pick one",
  );
});

Deno.test("branch renders creation, renaming, upstreams, and listings", () => {
  assertEquals(
    new GitBranchSettings().name("release/1.2").startPoint("origin/main")
      .argv(),
    ["git", "branch", "release/1.2", "origin/main"],
  );
  assertEquals(
    new GitBranchSettings().name("old").rename("new", true).argv(),
    ["git", "branch", "-M", "old", "new"],
  );
  assertEquals(
    new GitBranchSettings().name("feature").setUpstreamTo("origin/feature")
      .argv(),
    ["git", "branch", "--set-upstream-to=origin/feature", "feature"],
  );
  assertEquals(
    new GitBranchSettings().remotes().merged("origin/main")
      .contains("abc123").format("%(refname:short)").sort("-committerdate")
      .argv(),
    [
      "git",
      "branch",
      "--remotes",
      "--contains",
      "abc123",
      "--merged",
      "origin/main",
      "--format=%(refname:short)",
      "--sort=-committerdate",
    ],
  );
  assertThrows(
    () => new GitBranchSettings().rename("new").argv(),
    Error,
    ".name(...)",
  );
});

Deno.test("tag lists as well as creates, and refuses to do both", () => {
  assertEquals(
    new GitTagSettings().list("v1.*").sort("-v:refname").argv(),
    ["git", "tag", "--sort=-v:refname", "--list", "v1.*"],
  );
  assertEquals(new GitTagSettings().list().argv(), ["git", "tag", "--list"]);
  assertEquals(
    new GitTagSettings().name("v1.2.3").commit("abc123").argv(),
    ["git", "tag", "v1.2.3", "abc123"],
  );
  assertThrows(
    () => new GitTagSettings().list().name("v1.2.3").argv(),
    Error,
    ".list()",
  );
});

Deno.test("push renders the release flags and server options", () => {
  assertEquals(
    new GitPushSettings().followTags().atomic().dryRun()
      .pushOption("ci.skip").remote("origin").ref("main").argv(),
    [
      "git",
      "push",
      "--follow-tags",
      "--atomic",
      "--dry-run",
      "--push-option=ci.skip",
      "origin",
      "main",
    ],
  );
});

Deno.test("pull can pin merging, and refuses both rebase answers at once", () => {
  assertEquals(
    new GitPullSettings().noRebase().depth(1).tags().prune().remote("origin")
      .argv(),
    [
      "git",
      "pull",
      "--no-rebase",
      "--tags",
      "--prune",
      "--depth",
      "1",
      "origin",
    ],
  );
  assertThrows(
    () => new GitPullSettings().rebase().noRebase().argv(),
    Error,
    "pick one",
  );
});

Deno.test("fetch can deepen a shallow clone, but not while truncating it", () => {
  assertEquals(
    new GitFetchSettings().unshallow().force().remote("origin").argv(),
    ["git", "fetch", "--force", "--unshallow", "origin"],
  );
  assertThrows(
    () => new GitFetchSettings().unshallow().depth(1).argv(),
    Error,
    "pick one",
  );
});
