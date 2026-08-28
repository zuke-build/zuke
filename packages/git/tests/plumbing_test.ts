// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import {
  GitApplySettings,
  GitArchiveSettings,
  GitConfigSettings,
  GitLsRemoteSettings,
  GitRemoteSettings,
  GitSubmoduleSettings,
  GitTasks,
} from "../mod.ts";
import { parseRemoteList } from "../src/remote.ts";

Deno.test("remote renders each subcommand after the -v it takes first", () => {
  assertEquals(new GitRemoteSettings().argv(), ["git", "remote"]);
  assertEquals(new GitRemoteSettings().list().verbose().argv(), [
    "git",
    "remote",
    "--verbose",
  ]);
  assertEquals(
    new GitRemoteSettings().add("upstream", "https://host/up.git").argv(),
    ["git", "remote", "add", "upstream", "https://host/up.git"],
  );
  assertEquals(
    new GitRemoteSettings().add("upstream", "https://host/up.git").fetch()
      .track("main").argv(),
    [
      "git",
      "remote",
      "add",
      "-f",
      "-t",
      "main",
      "upstream",
      "https://host/up.git",
    ],
  );
  assertEquals(new GitRemoteSettings().remove("stale").argv(), [
    "git",
    "remote",
    "remove",
    "stale",
  ]);
  assertEquals(new GitRemoteSettings().rename("origin", "upstream").argv(), [
    "git",
    "remote",
    "rename",
    "origin",
    "upstream",
  ]);
  assertEquals(
    new GitRemoteSettings().setUrl("origin", "git@host:r.git").pushUrl().argv(),
    ["git", "remote", "set-url", "--push", "origin", "git@host:r.git"],
  );
  assertEquals(new GitRemoteSettings().getUrl("origin").argv(), [
    "git",
    "remote",
    "get-url",
    "origin",
  ]);
  assertEquals(new GitRemoteSettings().show("origin").argv(), [
    "git",
    "remote",
    "show",
    "origin",
  ]);
  assertEquals(new GitRemoteSettings().prune("origin").argv(), [
    "git",
    "remote",
    "prune",
    "origin",
  ]);
});

Deno.test("remote refuses an option its subcommand does not take", () => {
  // git would reject the flag; saying so here beats dropping it and running a
  // subtly different command.
  assertThrows(
    () => new GitRemoteSettings().show("origin").fetch().argv(),
    Error,
    ".fetch()",
  );
  assertThrows(
    () => new GitRemoteSettings().add("up", "u").pushUrl().argv(),
    Error,
    ".pushUrl()",
  );
});

Deno.test("parseRemoteList folds a remote's two lines into one entry", () => {
  const stdout = "origin\tgit@host:r.git (fetch)\n" +
    "origin\tgit@host:r.git (push)\n" +
    "upstream\thttps://host/up.git (fetch)\n" +
    "upstream\thttps://host/other.git (push)\n";
  assertEquals(parseRemoteList(stdout), [
    { name: "origin", fetchUrl: "git@host:r.git", pushUrl: "git@host:r.git" },
    {
      name: "upstream",
      fetchUrl: "https://host/up.git",
      pushUrl: "https://host/other.git",
    },
  ]);
  assertEquals(parseRemoteList(""), []);
  // A line with no URL is not an entry.
  assertEquals(parseRemoteList("origin\n"), []);
  assertEquals(parseRemoteList("origin\t\n"), []);
  // A remote can be a local path, and a path can contain a space — which is
  // why the direction comes off the end rather than the URL off a split.
  assertEquals(parseRemoteList("mirror\t/srv/my repos/r.git (fetch)\n"), [
    { name: "mirror", fetchUrl: "/srv/my repos/r.git" },
  ]);
});

Deno.test("ls-remote renders its filters and keeps patterns after the remote", () => {
  assertEquals(
    new GitLsRemoteSettings().heads().tags().refs().symref().exitCode()
      .remote("origin").patterns("main", "v1.*").argv(),
    [
      "git",
      "ls-remote",
      "--heads",
      "--tags",
      "--refs",
      "--symref",
      "--exit-code",
      "origin",
      "main",
      "v1.*",
    ],
  );
  // Without a remote, git would read the first pattern as one.
  assertThrows(
    () => new GitLsRemoteSettings().patterns("main").argv(),
    Error,
    ".remote(...)",
  );
});

Deno.test("config renders each operation and scope", () => {
  assertEquals(new GitConfigSettings().get("remote.origin.url").argv(), [
    "git",
    "config",
    "--get",
    "remote.origin.url",
  ]);
  assertEquals(
    new GitConfigSettings().getAll("remote.origin.fetch").local().argv(),
    ["git", "config", "--local", "--get-all", "remote.origin.fetch"],
  );
  assertEquals(
    new GitConfigSettings().set("user.name", "ci-bot").global().argv(),
    ["git", "config", "--global", "user.name", "ci-bot"],
  );
  assertEquals(
    new GitConfigSettings().add("safe.directory", "/src").system().argv(),
    ["git", "config", "--system", "--add", "safe.directory", "/src"],
  );
  assertEquals(new GitConfigSettings().unset("user.email").worktree().argv(), [
    "git",
    "config",
    "--worktree",
    "--unset",
    "user.email",
  ]);
  assertEquals(new GitConfigSettings().list().file(".gitmodules").argv(), [
    "git",
    "config",
    "--file",
    ".gitmodules",
    "--list",
  ]);
  assertEquals(
    new GitConfigSettings().get("core.editor").defaultValue("vi").argv(),
    ["git", "config", "--default", "vi", "--get", "core.editor"],
  );
});

Deno.test("config refuses no operation, and a scope that fights .file()", () => {
  assertThrows(() => new GitConfigSettings().argv(), Error, "no operation");
  assertThrows(
    () => new GitConfigSettings().get("a.b").global().file("x").argv(),
    Error,
    ".file(...)",
  );
});

Deno.test("configGet insists on an operation that produces a value", async () => {
  await assertRejects(
    () => GitTasks.configGet((s) => s.set("user.name", "ci-bot")),
    Error,
    ".get(key)",
  );
});

Deno.test("configGet reports an unset key as undefined, not a failure", async () => {
  // Hermetic: the running `deno` stands in for git — it exits non-zero on a
  // subcommand it does not have, which is exactly how `git config --get`
  // reports a key that is not set.
  const value = await GitTasks.configGet((s) =>
    s.get("zuke.unset.key").toolPath(Deno.execPath()).quiet()
  );
  assertEquals(value, undefined);
});

Deno.test("submodule renders each subcommand and its flags", () => {
  assertEquals(
    new GitSubmoduleSettings().update().withInit().recursive().depth(1).jobs(4)
      .argv(),
    [
      "git",
      "submodule",
      "update",
      "--init",
      "--recursive",
      "--depth",
      "1",
      "--jobs",
      "4",
    ],
  );
  // `submodule add [--] <repository> [<path>]`: the separator precedes the
  // repository, so the path after it stays a path rather than a second `--`
  // git would read as one.
  assertEquals(
    new GitSubmoduleSettings().add("https://host/lib.git", "vendor/lib")
      .branch("main").argv(),
    [
      "git",
      "submodule",
      "add",
      "-b",
      "main",
      "--",
      "https://host/lib.git",
      "vendor/lib",
    ],
  );
  assertEquals(new GitSubmoduleSettings().init().argv(), [
    "git",
    "submodule",
    "init",
  ]);
  assertEquals(
    new GitSubmoduleSettings().deinit().force().paths("vendor/lib").argv(),
    ["git", "submodule", "deinit", "--force", "--", "vendor/lib"],
  );
  assertEquals(new GitSubmoduleSettings().sync().recursive().argv(), [
    "git",
    "submodule",
    "sync",
    "--recursive",
  ]);
  assertEquals(new GitSubmoduleSettings().status().recursive().argv(), [
    "git",
    "submodule",
    "status",
    "--recursive",
  ]);
  assertEquals(
    new GitSubmoduleSettings().update().remote().argv(),
    ["git", "submodule", "update", "--remote"],
  );
  assertEquals(
    new GitSubmoduleSettings().foreach("git", "clean", "-xfd").recursive()
      .argv(),
    ["git", "submodule", "foreach", "--recursive", "git", "clean", "-xfd"],
  );
});

Deno.test("submodule refuses a missing subcommand and a misplaced --init", () => {
  assertThrows(
    () => new GitSubmoduleSettings().argv(),
    Error,
    "no subcommand",
  );
  assertThrows(
    () => new GitSubmoduleSettings().foreach().argv(),
    Error,
    ".foreach(...)",
  );
  assertThrows(
    () => new GitSubmoduleSettings().sync().withInit().argv(),
    Error,
    ".withInit()",
  );
  // `submodule status` has no --remote; dropping the flag silently would run
  // something the caller did not ask for.
  assertThrows(
    () => new GitSubmoduleSettings().status().remote().argv(),
    Error,
    ".remote()",
  );
});

Deno.test("archive needs a tree-ish and renders its packaging options", () => {
  assertEquals(
    new GitArchiveSettings()
      .format("tar.gz")
      .prefix("app-1.2.3/")
      .output("dist/app.tgz")
      .remote("origin")
      .treeish("v1.2.3")
      .paths("src")
      .argv(),
    [
      "git",
      "archive",
      "--format=tar.gz",
      "--prefix=app-1.2.3/",
      "--output=dist/app.tgz",
      "--remote=origin",
      "v1.2.3",
      "--",
      "src",
    ],
  );
  assertThrows(() => new GitArchiveSettings().argv(), Error, ".treeish(...)");
});

Deno.test("apply renders its options and refuses index+cached", () => {
  assertEquals(
    new GitApplySettings().check().reverse().threeWay().index().strip(0)
      .whitespace("fix").exclude("vendor/*").patches("fix.patch").argv(),
    [
      "git",
      "apply",
      "--check",
      "--reverse",
      "--3way",
      "--index",
      "-p0",
      "--whitespace=fix",
      "--exclude=vendor/*",
      "fix.patch",
    ],
  );
  assertEquals(new GitApplySettings().cached().argv(), [
    "git",
    "apply",
    "--cached",
  ]);
  assertThrows(
    () => new GitApplySettings().index().cached().argv(),
    Error,
    "pick one",
  );
});
