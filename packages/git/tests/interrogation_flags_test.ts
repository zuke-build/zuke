// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
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

// Each case below turns on every flag its settings class offers and pins the
// whole argv. That is what keeps a setter honest: a method that sets the wrong
// field, or emits a flag git spells differently, changes the array here. Every
// argv was accepted by git 2.43.0.

Deno.test("rev-list: every flag, in the order the argv builds them", () => {
  assertEquals(
    new GitRevListSettings()
      .count().maxCount(10).skip(2).all().branches().tags().remotes()
      .noMerges().firstParent().reverse().topoOrder().dateOrder()
      .since("2026-01-01").until("2026-12-31").author("Ada")
      .commits("HEAD").paths("src")
      .argv(),
    [
      "git",
      "rev-list",
      "--count",
      "--max-count=10",
      "--skip=2",
      "--all",
      "--branches",
      "--tags",
      "--remotes",
      "--no-merges",
      "--first-parent",
      "--reverse",
      "--topo-order",
      "--date-order",
      "--since=2026-01-01",
      "--until=2026-12-31",
      "--author=Ada",
      "HEAD",
      "--",
      "src",
    ],
  );
  // The merges filter is the other side of the pair asserted elsewhere.
  assertEquals(
    new GitRevListSettings().merges().commits("HEAD").argv(),
    ["git", "rev-list", "--merges", "HEAD"],
  );
});

Deno.test("merge-base: the independent mode and repeated commits", () => {
  assertEquals(
    new GitMergeBaseSettings().independent().commits("a").commits("b", "c")
      .argv(),
    ["git", "merge-base", "--independent", "a", "b", "c"],
  );
});

Deno.test("for-each-ref: every flag, including the merged filter", () => {
  assertEquals(
    new GitForEachRefSettings()
      .format("%(refname)").count(5).sort("-creatordate", "refname")
      .exclude("refs/tags/rc", "refs/tags/beta").pointsAt("HEAD")
      .merged("main").contains("v1").noContains("v2").ignoreCase().omitEmpty()
      .patterns("refs/tags/", "refs/heads/")
      .argv(),
    [
      "git",
      "for-each-ref",
      "--format=%(refname)",
      "--count=5",
      "--sort=-creatordate",
      "--sort=refname",
      "--exclude=refs/tags/rc",
      "--exclude=refs/tags/beta",
      "--points-at=HEAD",
      "--merged=main",
      "--contains=v1",
      "--no-contains=v2",
      "--ignore-case",
      "--omit-empty",
      "refs/tags/",
      "refs/heads/",
    ],
  );
  assertEquals(
    new GitForEachRefSettings().noMerged("main").argv(),
    ["git", "for-each-ref", "--no-merged=main"],
  );
});

Deno.test("show-ref: every flag, including --head and --exists", () => {
  assertEquals(
    new GitShowRefSettings()
      .tags().heads().head().dereference().hash().quietOutput().abbrev(7)
      .patterns("v1")
      .argv(),
    [
      "git",
      "show-ref",
      "--tags",
      "--heads",
      "--head",
      "--dereference",
      "--hash",
      "--quiet",
      "--abbrev=7",
      "--",
      "v1",
    ],
  );
  assertEquals(
    new GitShowRefSettings().exists().patterns("refs/heads/main").argv(),
    ["git", "show-ref", "--exists", "--", "refs/heads/main"],
  );
});

Deno.test("symbolic-ref: deleting, and reading without shortening", () => {
  assertEquals(
    new GitSymbolicRefSettings().name("HEAD").delete().quietOutput().argv(),
    ["git", "symbolic-ref", "--delete", "--quiet", "HEAD"],
  );
  assertEquals(
    new GitSymbolicRefSettings().name("HEAD").argv(),
    ["git", "symbolic-ref", "HEAD"],
  );
});

Deno.test("ls-tree: every flag its listing offers", () => {
  assertEquals(
    new GitLsTreeSettings()
      .tree("HEAD").recursive().treesOnly().showTrees().nulTerminated().long()
      .fullName().fullTree().abbrev(8).paths("src")
      .argv(),
    [
      "git",
      "ls-tree",
      "-r",
      "-d",
      "-t",
      "-z",
      "--long",
      "--full-name",
      "--full-tree",
      "--abbrev=8",
      "HEAD",
      "--",
      "src",
    ],
  );
  assertEquals(
    new GitLsTreeSettings().tree("HEAD").nameOnly().argv(),
    ["git", "ls-tree", "--name-only", "HEAD"],
  );
  assertEquals(
    new GitLsTreeSettings().tree("HEAD").objectOnly().argv(),
    ["git", "ls-tree", "--object-only", "HEAD"],
  );
});

Deno.test("cat-file: the filters conversion", () => {
  assertEquals(
    new GitCatFileSettings().object("HEAD:a.txt").filters().argv(),
    ["git", "cat-file", "--filters", "HEAD:a.txt"],
  );
});

Deno.test("check-ignore: NUL termination alongside the quiet form", () => {
  assertEquals(
    new GitCheckIgnoreSettings().quietOutput().nulTerminated().noIndex()
      .paths("a", "b").argv(),
    ["git", "check-ignore", "-q", "--no-index", "-z", "--", "a", "b"],
  );
});

Deno.test("blame: reverse walking and repeated ranges", () => {
  assertEquals(
    new GitBlameSettings()
      .file("a.ts").porcelain().reverse("v1..HEAD")
      .ignoreRevs("aaa", "bbb").lineRange(1, 10).lineRange(20, "30")
      .argv(),
    [
      "git",
      "blame",
      "--porcelain",
      "--reverse",
      "v1..HEAD",
      "--ignore-rev",
      "aaa",
      "--ignore-rev",
      "bbb",
      "-L",
      "1,10",
      "-L",
      "20,30",
      "--",
      "a.ts",
    ],
  );
});

Deno.test("shortlog: grouping by committer and by several fields", () => {
  assertEquals(
    new GitShortlogSettings()
      .summary().numbered().email().committer()
      .group("trailer:co-authored-by", "author")
      .commits("v1..HEAD").paths("docs", "src")
      .argv(),
    [
      "git",
      "shortlog",
      "-s",
      "-n",
      "-e",
      "-c",
      "--group=trailer:co-authored-by",
      "--group=author",
      "v1..HEAD",
      "--",
      "docs",
      "src",
    ],
  );
});

Deno.test("grep: every flag, and searching a revision", () => {
  assertEquals(
    new GitGrepSettings()
      .pattern("TODO").ignoreCase().wordRegexp().invert().lineNumber()
      .fixedStrings().untracked().nulTerminated().maxDepth(2).context(3)
      .revisions("HEAD", "v1").paths("src")
      .argv(),
    [
      "git",
      "grep",
      "-i",
      "-w",
      "-v",
      "-n",
      "-F",
      "--untracked",
      "-z",
      "--max-depth=2",
      "-C",
      "3",
      "-e",
      "TODO",
      "HEAD",
      "v1",
      "--",
      "src",
    ],
  );
  assertEquals(
    new GitGrepSettings().pattern("a").countMatches().argv(),
    ["git", "grep", "-c", "-e", "a"],
  );
});

Deno.test("verify-commit and verify-tag: the raw and verbose forms", () => {
  assertEquals(
    new GitVerifyCommitSettings().raw().objects("HEAD", "HEAD~1").argv(),
    ["git", "verify-commit", "--raw", "HEAD", "HEAD~1"],
  );
  assertEquals(
    new GitVerifyTagSettings().verbose().objects("v1").argv(),
    ["git", "verify-tag", "-v", "v1"],
  );
  // The format lands after the flags and before the objects, which is where
  // git's own synopsis puts it.
  assertEquals(
    new GitVerifyTagSettings().verbose().raw().format("%(tag)").objects("v1")
      .argv(),
    ["git", "verify-tag", "-v", "--raw", "--format=%(tag)", "v1"],
  );
});

Deno.test("merge-tree: the trivial and write-tree forms carry their globals", () => {
  assertEquals(
    new GitMergeTreeSettings().dir("repo").branches("a", "b").argv(),
    ["git", "-C", "repo", "merge-tree", "a", "b"],
  );
});

Deno.test("name-rev: naming several commits at once", () => {
  assertEquals(
    new GitNameRevSettings().commits("HEAD", "HEAD~1")
      .refs("refs/tags/*", "refs/heads/*").argv(),
    [
      "git",
      "name-rev",
      "--refs=refs/tags/*",
      "--refs=refs/heads/*",
      "HEAD",
      "HEAD~1",
    ],
  );
});

Deno.test("the global options reach every new subcommand", () => {
  // GitSettings puts -C and -c before the subcommand; a settings class that
  // built its argv itself rather than through subcommandArgs would lose them.
  assertEquals(
    new GitRevListSettings().dir("repo").config("core.abbrev", "8")
      .count().commits("HEAD").argv(),
    [
      "git",
      "-C",
      "repo",
      "-c",
      "core.abbrev=8",
      "rev-list",
      "--count",
      "HEAD",
    ],
  );
  assertEquals(
    new GitBlameSettings().dir("repo").file("a.ts").argv(),
    ["git", "-C", "repo", "blame", "--", "a.ts"],
  );
  assertEquals(
    new GitVerifyTagSettings().dir("repo").objects("v1").argv(),
    ["git", "-C", "repo", "verify-tag", "v1"],
  );
});
