import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
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
  GitTagSettings,
  GitTasks,
} from "../src/git.ts";

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
  assertEquals(
    new GitCheckoutSettings().create().force().ref("feature").argv(),
    ["git", "checkout", "-b", "--force", "feature"],
  );
  assertThrows(() => new GitCheckoutSettings().argv(), Error, ".ref()");
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

Deno.test("run executes an arbitrary command", () => {
  assertEquals(
    new GitRunSettings().command("rev-parse", "--short", "HEAD").argv(),
    ["git", "rev-parse", "--short", "HEAD"],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-git-zz");
};

Deno.test("GitTasks.status reaches execution", async () => {
  await assertRejects(() => GitTasks.status(missing), ToolNotFoundError);
});
