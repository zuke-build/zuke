// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GitAddSettings,
  GitCleanSettings,
  GitMvSettings,
  GitRestoreSettings,
  GitRmSettings,
} from "../mod.ts";

Deno.test("add renders the flags that stage what git would otherwise skip", () => {
  assertEquals(
    new GitAddSettings().force().intentToAdd().paths("dist/app.js").argv(),
    ["git", "add", "--force", "--intent-to-add", "--", "dist/app.js"],
  );
});

Deno.test("rm requires paths and renders its options", () => {
  assertEquals(
    new GitRmSettings().cached().recursive().force().dryRun().ignoreUnmatch()
      .paths("secret.env").argv(),
    [
      "git",
      "rm",
      "--cached",
      "-r",
      "--force",
      "--dry-run",
      "--ignore-unmatch",
      "--",
      "secret.env",
    ],
  );
  assertThrows(() => new GitRmSettings().argv(), Error, ".paths(...)");
});

Deno.test("mv needs both ends and puts the destination last", () => {
  assertEquals(
    new GitMvSettings().force().dryRun().sources("a.ts", "b.ts")
      .destination("src").argv(),
    ["git", "mv", "--force", "--dry-run", "a.ts", "b.ts", "src"],
  );
  assertThrows(
    () => new GitMvSettings().sources("a.ts").argv(),
    Error,
    ".destination(...)",
  );
  assertThrows(
    () => new GitMvSettings().destination("src").argv(),
    Error,
    ".sources(...)",
  );
});

Deno.test("restore renders its source and both targets", () => {
  assertEquals(
    new GitRestoreSettings().source("HEAD~1").staged().worktree()
      .paths("src", "docs").argv(),
    [
      "git",
      "restore",
      "--source=HEAD~1",
      "--staged",
      "--worktree",
      "--",
      "src",
      "docs",
    ],
  );
  assertThrows(() => new GitRestoreSettings().argv(), Error, ".paths(...)");
});

Deno.test("clean refuses to run without --force or --dry-run", () => {
  // git itself refuses (clean.requireForce), and a build that meant to delete
  // build output should hear that here rather than from a confusing exit 128.
  assertThrows(
    () => new GitCleanSettings().directories().argv(),
    Error,
    ".force()",
  );
  assertEquals(
    new GitCleanSettings().dryRun().directories().argv(),
    ["git", "clean", "--dry-run", "-d"],
  );
});

Deno.test("clean renders the ignore switches and excludes", () => {
  assertEquals(
    new GitCleanSettings().force().directories().includeIgnored()
      .exclude("*.pem", "local/").paths("build").argv(),
    [
      "git",
      "clean",
      "--force",
      "-d",
      "-x",
      "--exclude=*.pem",
      "--exclude=local/",
      "--",
      "build",
    ],
  );
  assertEquals(
    new GitCleanSettings().force().onlyIgnored().argv(),
    ["git", "clean", "--force", "-X"],
  );
  // -x removes ignored files as well; -X removes only those. Both is nonsense.
  assertThrows(
    () => new GitCleanSettings().force().includeIgnored().onlyIgnored().argv(),
    Error,
    "opposites",
  );
});
