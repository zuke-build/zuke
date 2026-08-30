// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GitBlameSettings,
  GitCatFileSettings,
  GitCheckIgnoreSettings,
  GitForEachRefSettings,
  GitGrepSettings,
  GitLsTreeSettings,
  GitMergeBaseSettings,
  GitMergeTreeSettings,
  GitNameRevSettings,
  GitRevListSettings,
  GitShortlogSettings,
  GitShowRefSettings,
  GitSymbolicRefSettings,
  GitVerifyCommitSettings,
  GitVerifyTagSettings,
} from "../mod.ts";

// Every argv asserted here was run through git 2.43.0 before being written
// down, so these are command lines the real CLI accepts rather than only ones
// this wrapper happens to produce.

Deno.test("merge-base: argv, and the modes git treats as separate usages", () => {
  assertEquals(
    new GitMergeBaseSettings().commits("HEAD", "origin/main").argv(),
    ["git", "merge-base", "HEAD", "origin/main"],
  );
  assertEquals(
    new GitMergeBaseSettings().all().octopus().commits("a", "b").argv(),
    ["git", "merge-base", "--all", "--octopus", "a", "b"],
  );
  assertEquals(
    new GitMergeBaseSettings().forkPoint().commits("main", "HEAD").argv(),
    ["git", "merge-base", "--fork-point", "main", "HEAD"],
  );
  const noCommits = assertThrows(
    () => new GitMergeBaseSettings().argv(),
    Error,
  );
  assertEquals(noCommits.message.includes(".commits(a, b)"), true);
  // git: "--independent is incompatible with --is-ancestor".
  const twoModes = assertThrows(
    () =>
      new GitMergeBaseSettings().isAncestor().independent().commits("a", "b")
        .argv(),
    Error,
  );
  assertEquals(twoModes.message.includes("pick one"), true);
});

Deno.test("merge-base: --all is refused only where git rejects it", () => {
  // git: "options '--is-ancestor' and '--all' cannot be used together".
  assertThrows(
    () =>
      new GitMergeBaseSettings().all().isAncestor().commits("a", "b").argv(),
    Error,
    ".all() cannot be combined with .isAncestor()",
  );
  assertThrows(
    () => new GitMergeBaseSettings().all().independent().commits("a").argv(),
    Error,
    ".all() cannot be combined with .independent()",
  );
  // ...but git accepts it beside --octopus and --fork-point, so the wrapper
  // must not invent a refusal there.
  assertEquals(
    new GitMergeBaseSettings().all().forkPoint().commits("a", "b").argv(),
    ["git", "merge-base", "--all", "--fork-point", "a", "b"],
  );
});

Deno.test("merge-base: --is-ancestor takes exactly two commits", () => {
  // git: "--is-ancestor takes exactly two commits".
  assertThrows(
    () => new GitMergeBaseSettings().isAncestor().commits("a").argv(),
    Error,
    "exactly two commits",
  );
  assertThrows(
    () => new GitMergeBaseSettings().isAncestor().commits("a", "b", "c").argv(),
    Error,
    "exactly two commits",
  );
});

Deno.test("rev-list: argv and the starting point it requires", () => {
  assertEquals(
    new GitRevListSettings().count().commits("HEAD").argv(),
    ["git", "rev-list", "--count", "HEAD"],
  );
  assertEquals(
    new GitRevListSettings()
      .count().maxCount(5).skip(1).noMerges().firstParent()
      .since("2026-01-01").author("Ada").commits("main..HEAD").argv(),
    [
      "git",
      "rev-list",
      "--count",
      "--max-count=5",
      "--skip=1",
      "--no-merges",
      "--first-parent",
      "--since=2026-01-01",
      "--author=Ada",
      "main..HEAD",
    ],
  );
  // A ref selector is a starting point too, so this must not throw.
  assertEquals(
    new GitRevListSettings().count().all().argv(),
    ["git", "rev-list", "--count", "--all"],
  );
  assertThrows(
    () => new GitRevListSettings().count().argv(),
    Error,
    "no starting point",
  );
});

Deno.test("rev-list: the contradiction git answers with a plausible zero", () => {
  // git accepts --merges --no-merges and reports 0 commits, which reads like a
  // real empty result rather than the impossible request it is.
  assertThrows(
    () => new GitRevListSettings().merges().noMerges().commits("HEAD").argv(),
    Error,
    "always reports zero commits",
  );
});

Deno.test("rev-list: paths are separated from revisions by --", () => {
  assertEquals(
    new GitRevListSettings().commits("HEAD").paths("src", "-weird").argv(),
    ["git", "rev-list", "HEAD", "--", "src", "-weird"],
  );
});

Deno.test("for-each-ref: argv and the disjoint filters", () => {
  assertEquals(
    new GitForEachRefSettings().sort("-creatordate").count(3)
      .patterns("refs/tags/").argv(),
    ["git", "for-each-ref", "--count=3", "--sort=-creatordate", "refs/tags/"],
  );
  assertEquals(
    new GitForEachRefSettings().pointsAt("HEAD").contains("v1")
      .noContains("v2").ignoreCase().omitEmpty().exclude("refs/tags/rc")
      .argv(),
    [
      "git",
      "for-each-ref",
      "--exclude=refs/tags/rc",
      "--points-at=HEAD",
      "--contains=v1",
      "--no-contains=v2",
      "--ignore-case",
      "--omit-empty",
    ],
  );
  assertThrows(
    () => new GitForEachRefSettings().merged("a").noMerged("b").argv(),
    Error,
    "match nothing",
  );
});

Deno.test("show-ref: argv, and --verify against --exists", () => {
  assertEquals(
    new GitShowRefSettings().tags().heads().dereference().abbrev(8)
      .patterns("v1").argv(),
    [
      "git",
      "show-ref",
      "--tags",
      "--heads",
      "--dereference",
      "--abbrev=8",
      "--",
      "v1",
    ],
  );
  assertEquals(
    new GitShowRefSettings().verify().quietOutput()
      .patterns("refs/heads/main").argv(),
    ["git", "show-ref", "--verify", "--quiet", "--", "refs/heads/main"],
  );
  assertThrows(
    () => new GitShowRefSettings().verify().exists().argv(),
    Error,
    "pick one",
  );
});

Deno.test("symbolic-ref: reading, writing, and what cannot be both", () => {
  assertEquals(
    new GitSymbolicRefSettings().name("HEAD").short().argv(),
    ["git", "symbolic-ref", "--short", "HEAD"],
  );
  assertEquals(
    new GitSymbolicRefSettings().name("HEAD").ref("refs/heads/main")
      .reason("point at main").argv(),
    ["git", "symbolic-ref", "-m", "point at main", "HEAD", "refs/heads/main"],
  );
  assertThrows(
    () => new GitSymbolicRefSettings().argv(),
    Error,
    "no ref named",
  );
  assertThrows(
    () =>
      new GitSymbolicRefSettings().name("HEAD").short().ref("refs/heads/main")
        .argv(),
    Error,
    "drop one",
  );
});

Deno.test("name-rev: argv, and that --all is a starting point of its own", () => {
  assertEquals(
    new GitNameRevSettings().tags().nameOnly().alwaysName().commits("HEAD")
      .argv(),
    ["git", "name-rev", "--tags", "--name-only", "--always", "HEAD"],
  );
  assertEquals(
    new GitNameRevSettings().all().refs("refs/tags/*").argv(),
    ["git", "name-rev", "--all", "--refs=refs/tags/*"],
  );
  assertThrows(
    () => new GitNameRevSettings().argv(),
    Error,
    "no commits given",
  );
});

Deno.test("ls-tree: argv, the tree it needs, and the single-column forms", () => {
  assertEquals(
    new GitLsTreeSettings().tree("HEAD").recursive().long().nulTerminated()
      .paths("packages").argv(),
    ["git", "ls-tree", "-r", "-z", "--long", "HEAD", "--", "packages"],
  );
  assertThrows(
    () => new GitLsTreeSettings().argv(),
    Error,
    "no tree given",
  );
  // git: "--object-only is incompatible with --name-only".
  assertThrows(
    () => new GitLsTreeSettings().tree("HEAD").nameOnly().objectOnly().argv(),
    Error,
    "pick one",
  );
});

Deno.test("cat-file: the query forms and the contents form", () => {
  assertEquals(
    new GitCatFileSettings().object("HEAD:deno.json").argv(),
    ["git", "cat-file", "-p", "HEAD:deno.json"],
  );
  assertEquals(
    new GitCatFileSettings().object("HEAD").query("type").argv(),
    ["git", "cat-file", "-t", "HEAD"],
  );
  assertEquals(
    new GitCatFileSettings().object("HEAD").query("size").argv(),
    ["git", "cat-file", "-s", "HEAD"],
  );
  assertEquals(
    new GitCatFileSettings().object("HEAD").query("exists").argv(),
    ["git", "cat-file", "-e", "HEAD"],
  );
  assertEquals(
    new GitCatFileSettings().object("HEAD:a.txt").textconv().argv(),
    ["git", "cat-file", "--textconv", "HEAD:a.txt"],
  );
  assertThrows(
    () => new GitCatFileSettings().argv(),
    Error,
    "no object given",
  );
  assertThrows(
    () => new GitCatFileSettings().object("HEAD").textconv().filters().argv(),
    Error,
    "pick one",
  );
});

Deno.test("check-ignore: the two pairings git itself rejects", () => {
  assertEquals(
    new GitCheckIgnoreSettings().quietOutput().paths("cov_profile").argv(),
    ["git", "check-ignore", "-q", "--", "cov_profile"],
  );
  assertEquals(
    new GitCheckIgnoreSettings().verbose().nonMatching().noIndex()
      .paths("a.ts").argv(),
    ["git", "check-ignore", "-v", "-n", "--no-index", "--", "a.ts"],
  );
  assertThrows(
    () => new GitCheckIgnoreSettings().argv(),
    Error,
    "no paths given",
  );
  // git: "--non-matching is only valid with --verbose".
  assertThrows(
    () => new GitCheckIgnoreSettings().nonMatching().paths("a.ts").argv(),
    Error,
    "needs .verbose()",
  );
  // git: "cannot have both --quiet and --verbose".
  assertThrows(
    () =>
      new GitCheckIgnoreSettings().quietOutput().verbose().paths("a.ts").argv(),
    Error,
    "Keep one",
  );
});

Deno.test("blame: argv, the file it needs, and the two porcelain forms", () => {
  assertEquals(
    new GitBlameSettings().file("mod.ts").porcelain().lineRange(1, 40).argv(),
    ["git", "blame", "--porcelain", "-L", "1,40", "--", "mod.ts"],
  );
  assertEquals(
    new GitBlameSettings().file("mod.ts").linePorcelain().showEmail()
      .ignoreWhitespace().revision("v1").ignoreRevs("abc").argv(),
    [
      "git",
      "blame",
      "--line-porcelain",
      "-e",
      "-w",
      "--ignore-rev",
      "abc",
      "v1",
      "--",
      "mod.ts",
    ],
  );
  assertThrows(() => new GitBlameSettings().argv(), Error, "no file given");
  assertThrows(
    () => new GitBlameSettings().file("a").porcelain().linePorcelain().argv(),
    Error,
    "pick one",
  );
});

Deno.test("shortlog: argv, with paths kept apart from revisions", () => {
  assertEquals(
    new GitShortlogSettings().summary().numbered().email().commits("v1..HEAD")
      .argv(),
    ["git", "shortlog", "-s", "-n", "-e", "v1..HEAD"],
  );
  assertEquals(
    new GitShortlogSettings().summary().committer().group("trailer:acked-by")
      .commits("HEAD").paths("docs").argv(),
    [
      "git",
      "shortlog",
      "-s",
      "-c",
      "--group=trailer:acked-by",
      "HEAD",
      "--",
      "docs",
    ],
  );
});

Deno.test("grep: argv, with -e before every pattern", () => {
  assertEquals(
    new GitGrepSettings().pattern("TODO").lineNumber().ignoreCase()
      .extendedRegexp().context(1).maxDepth(3).paths("src").argv(),
    [
      "git",
      "grep",
      "-i",
      "-n",
      "-E",
      "--max-depth=3",
      "-C",
      "1",
      "-e",
      "TODO",
      "--",
      "src",
    ],
  );
  // `-e` is what keeps a pattern beginning with `-` a pattern.
  assertEquals(
    new GitGrepSettings().pattern("-x", "--y").argv(),
    ["git", "grep", "-e", "-x", "-e", "--y"],
  );
  assertThrows(() => new GitGrepSettings().argv(), Error, "no pattern given");
});

Deno.test("grep: the pairings git accepts but answers differently than asked", () => {
  // git accepts -E -F and lets the last flag win, so `Zu.e` matches or does
  // not depending only on call order.
  assertThrows(
    () =>
      new GitGrepSettings().pattern("a").extendedRegexp().fixedStrings().argv(),
    Error,
    "last flag win",
  );
  // git accepts -l -c and silently drops the counts.
  assertThrows(
    () => new GitGrepSettings().pattern("a").namesOnly().countMatches().argv(),
    Error,
    "silently drops the counts",
  );
  // git: "options '--untracked' and '--cached' cannot be used together".
  assertThrows(
    () => new GitGrepSettings().pattern("a").cached().untracked().argv(),
    Error,
    "Keep one",
  );
});

Deno.test("verify-commit and verify-tag: argv, and the format only one takes", () => {
  assertEquals(
    new GitVerifyCommitSettings().verbose().objects("HEAD").argv(),
    ["git", "verify-commit", "-v", "HEAD"],
  );
  assertEquals(
    new GitVerifyTagSettings().raw().format("%(tag)").objects("v1", "v2")
      .argv(),
    ["git", "verify-tag", "--raw", "--format=%(tag)", "v1", "v2"],
  );
  assertThrows(
    () => new GitVerifyCommitSettings().argv(),
    Error,
    "no objects given",
  );
  assertThrows(
    () => new GitVerifyTagSettings().argv(),
    Error,
    "no objects given",
  );
});

Deno.test("merge-tree: argv, and that it merges exactly two commits", () => {
  assertEquals(
    new GitMergeTreeSettings().branches("HEAD", "origin/main").messages()
      .argv(),
    ["git", "merge-tree", "--messages", "HEAD", "origin/main"],
  );
  assertEquals(
    new GitMergeTreeSettings().writeTree().nameOnly().nulTerminated()
      .allowUnrelatedHistories().mergeBase("base").branches("a", "b").argv(),
    [
      "git",
      "merge-tree",
      "--write-tree",
      "--name-only",
      "-z",
      "--allow-unrelated-histories",
      "--merge-base=base",
      "a",
      "b",
    ],
  );
  assertThrows(
    () => new GitMergeTreeSettings().branches("only-one").argv(),
    Error,
    "merges two commits",
  );
});
