// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GitCherryPickSettings,
  GitMergeSettings,
  GitRebaseSettings,
  GitResetSettings,
  GitRevertSettings,
  GitStashSettings,
} from "../mod.ts";

Deno.test("merge renders its strategy, message, and refs", () => {
  assertEquals(
    new GitMergeSettings()
      .noFf()
      .noCommit()
      .allowUnrelatedHistories()
      .strategy("ort")
      .strategyOption("theirs", "ignore-space-change")
      .message("chore: merge main")
      .refs("origin/main")
      .argv(),
    [
      "git",
      "merge",
      "--no-ff",
      "--no-commit",
      "--allow-unrelated-histories",
      "--strategy=ort",
      "--strategy-option=theirs",
      "--strategy-option=ignore-space-change",
      "-m",
      "chore: merge main",
      "origin/main",
    ],
  );
  assertEquals(
    new GitMergeSettings().ffOnly().squash().refs("feature").argv(),
    ["git", "merge", "--ff-only", "--squash", "feature"],
  );
});

Deno.test("merge refuses the contradictions git would only report as usage", () => {
  assertThrows(() => new GitMergeSettings().argv(), Error, ".refs(...)");
  assertThrows(
    () => new GitMergeSettings().noFf().ffOnly().refs("x").argv(),
    Error,
    "pick one",
  );
});

Deno.test("a control flag runs alone, on every command that has one", () => {
  assertEquals(new GitMergeSettings().abort().argv(), [
    "git",
    "merge",
    "--abort",
  ]);
  assertEquals(new GitMergeSettings().quit().argv(), [
    "git",
    "merge",
    "--quit",
  ]);
  assertEquals(new GitRebaseSettings().continue().argv(), [
    "git",
    "rebase",
    "--continue",
  ]);
  assertEquals(new GitRebaseSettings().skip().argv(), [
    "git",
    "rebase",
    "--skip",
  ]);
  assertEquals(new GitCherryPickSettings().abort().argv(), [
    "git",
    "cherry-pick",
    "--abort",
  ]);
  assertEquals(new GitRevertSettings().skip().argv(), [
    "git",
    "revert",
    "--skip",
  ]);
});

Deno.test("a control flag alongside the command's own arguments is refused", () => {
  // git resumes or drops the operation already in progress and takes nothing
  // else; the refusal names the argument that has no meaning, rather than
  // dropping it and running something the caller did not ask for.
  assertThrows(
    () => new GitMergeSettings().abort().refs("main").argv(),
    Error,
    "`main` has no meaning",
  );
  assertThrows(
    () => new GitMergeSettings().abort().noFf().argv(),
    Error,
    "`--no-ff` has no meaning",
  );
  assertThrows(
    () => new GitRebaseSettings().continue().upstream("origin/main").argv(),
    Error,
    "`origin/main` has no meaning",
  );
  assertThrows(
    () => new GitRebaseSettings().skip().autostash().argv(),
    Error,
    "`--autostash` has no meaning",
  );
  assertThrows(
    () => new GitCherryPickSettings().skip().commits("abc123").argv(),
    Error,
    "GitTasks.cherryPick",
  );
  assertThrows(
    () => new GitRevertSettings().abort().noEdit().argv(),
    Error,
    "GitTasks.revert",
  );
});

Deno.test("rebase renders --onto before the upstream and branch", () => {
  assertEquals(
    new GitRebaseSettings()
      .autosquash()
      .autostash()
      .keepEmpty()
      .rebaseMerges()
      .strategy("ort")
      .strategyOption("theirs")
      .onto("origin/main")
      .upstream("v1.2.0")
      .branch("feature")
      .argv(),
    [
      "git",
      "rebase",
      "--autosquash",
      "--autostash",
      "--keep-empty",
      "--rebase-merges",
      "--strategy=ort",
      "--strategy-option=theirs",
      "--onto",
      "origin/main",
      "v1.2.0",
      "feature",
    ],
  );
  assertThrows(
    () => new GitRebaseSettings().argv(),
    Error,
    ".upstream(...)",
  );
});

Deno.test("cherry-pick and revert share the replay flags and add their own", () => {
  assertEquals(
    new GitCherryPickSettings().noCommit().signoff().mainline(1).allowEmpty()
      .ff().commits("abc123", "def456").argv(),
    [
      "git",
      "cherry-pick",
      "--no-commit",
      "--signoff",
      "--mainline",
      "1",
      "--allow-empty",
      "--ff",
      "abc123",
      "def456",
    ],
  );
  assertEquals(
    new GitRevertSettings().noEdit().mainline(2).commits("abc123").argv(),
    ["git", "revert", "--mainline", "2", "--no-edit", "abc123"],
  );
  assertThrows(
    () => new GitCherryPickSettings().argv(),
    Error,
    ".commits(...)",
  );
  assertThrows(() => new GitRevertSettings().argv(), Error, ".commits(...)");
});

Deno.test("reset renders each mode, and refuses a mode with pathspecs", () => {
  assertEquals(new GitResetSettings().hard().ref("origin/main").argv(), [
    "git",
    "reset",
    "--hard",
    "origin/main",
  ]);
  assertEquals(new GitResetSettings().soft().ref("HEAD~1").argv(), [
    "git",
    "reset",
    "--soft",
    "HEAD~1",
  ]);
  assertEquals(new GitResetSettings().mixed().argv(), [
    "git",
    "reset",
    "--mixed",
  ]);
  assertEquals(new GitResetSettings().merge().argv(), [
    "git",
    "reset",
    "--merge",
  ]);
  assertEquals(new GitResetSettings().keep().argv(), [
    "git",
    "reset",
    "--keep",
  ]);
  // Unstaging: no mode, just paths.
  assertEquals(new GitResetSettings().paths("dist", "-odd.txt").argv(), [
    "git",
    "reset",
    "--",
    "dist",
    "-odd.txt",
  ]);
  assertThrows(
    () => new GitResetSettings().hard().paths("dist").argv(),
    Error,
    "--hard",
  );
});

Deno.test("stash renders each subcommand", () => {
  assertEquals(
    new GitStashSettings().push().includeUntracked().keepIndex().staged()
      .message("before regen").paths("packages").argv(),
    [
      "git",
      "stash",
      "push",
      "--include-untracked",
      "--keep-index",
      "--staged",
      "-m",
      "before regen",
      "--",
      "packages",
    ],
  );
  assertEquals(new GitStashSettings().pop().argv(), ["git", "stash", "pop"]);
  assertEquals(
    new GitStashSettings().apply().stash("stash@{2}").argv(),
    ["git", "stash", "apply", "stash@{2}"],
  );
  assertEquals(
    new GitStashSettings().drop().stash("stash@{0}").argv(),
    ["git", "stash", "drop", "stash@{0}"],
  );
  assertEquals(new GitStashSettings().show().argv(), ["git", "stash", "show"]);
  assertEquals(new GitStashSettings().list().argv(), ["git", "stash", "list"]);
  assertEquals(new GitStashSettings().clear().argv(), [
    "git",
    "stash",
    "clear",
  ]);
});

Deno.test("stash refuses a subcommand it was never given, or a stash push cannot take", () => {
  assertThrows(() => new GitStashSettings().argv(), Error, "no subcommand");
  assertThrows(
    () => new GitStashSettings().push().stash("stash@{0}").argv(),
    Error,
    ".push()",
  );
  // The options that describe *what* to stash belong to `push`; on `pop` they
  // would be dropped, running something the caller did not ask for.
  assertThrows(
    () => new GitStashSettings().pop().includeUntracked().argv(),
    Error,
    ".includeUntracked()",
  );
  assertThrows(
    () => new GitStashSettings().list().message("x").argv(),
    Error,
    ".message(...)",
  );
  assertThrows(
    () => new GitStashSettings().drop().paths("src").argv(),
    Error,
    ".paths(...)",
  );
  assertThrows(
    () => new GitStashSettings().apply().keepIndex().argv(),
    Error,
    ".keepIndex()",
  );
  assertThrows(
    () => new GitStashSettings().show().staged().argv(),
    Error,
    ".staged()",
  );
});
