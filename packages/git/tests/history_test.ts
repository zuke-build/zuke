// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import {
  GitDescribeSettings,
  GitDiffSettings,
  GitLogSettings,
  GitLsFilesSettings,
  GitRevParseSettings,
  GitShowSettings,
  GitStatusSettings,
  GitTasks,
  LOG_ENTRY_FORMAT,
} from "../mod.ts";
import { parseLogEntries } from "../src/log.ts";
import { parseStatusEntries } from "../src/status.ts";
import { splitNul } from "../src/nul_records.ts";

Deno.test("log renders its filters, then revisions, then pathspecs", () => {
  assertEquals(
    new GitLogSettings()
      .maxCount(20)
      .skip(5)
      .noMerges()
      .firstParent()
      .reverse()
      .since("2026-01-01")
      .until("2026-02-01")
      .author("ci-bot")
      .grep("^feat", "^fix")
      .range("v1.2.0")
      .paths("packages/core")
      .argv(),
    [
      "git",
      "log",
      "--max-count=20",
      "--skip=5",
      "--no-merges",
      "--first-parent",
      "--reverse",
      "--since=2026-01-01",
      "--until=2026-02-01",
      "--author=ci-bot",
      "--grep=^feat",
      "--grep=^fix",
      "v1.2.0..HEAD",
      "--",
      "packages/core",
    ],
  );
});

Deno.test("log: --format is rendered last so it wins over --oneline", () => {
  // git applies the final formatting option it is given, which is what lets
  // `logEntries` pin its own format over whatever the lambda asked for.
  assertEquals(
    new GitLogSettings().oneline().format("%H %s").revisions("HEAD").argv(),
    ["git", "log", "--oneline", "--format=%H %s", "HEAD"],
  );
});

Deno.test("log: --follow tracks exactly one path", () => {
  assertEquals(
    new GitLogSettings().follow().paths("mod.ts").argv(),
    ["git", "log", "--follow", "--", "mod.ts"],
  );
  assertThrows(
    () => new GitLogSettings().follow().argv(),
    Error,
    "exactly one path",
  );
  assertThrows(
    () => new GitLogSettings().follow().paths("a.ts", "b.ts").argv(),
    Error,
    "exactly one path",
  );
});

Deno.test("show renders its formats, objects, and pathspecs", () => {
  assertEquals(
    new GitShowSettings().noPatch().format("%s").object("HEAD").argv(),
    ["git", "show", "--no-patch", "--format=%s", "HEAD"],
  );
  assertEquals(
    new GitShowSettings().nameStatus().nameOnly().stat()
      .object("HEAD", "HEAD~1").paths("src").argv(),
    [
      "git",
      "show",
      "--name-status",
      "--name-only",
      "--stat",
      "HEAD",
      "HEAD~1",
      "--",
      "src",
    ],
  );
});

Deno.test("diff renders its options in git's own order", () => {
  assertEquals(
    new GitDiffSettings()
      .staged()
      .stat()
      .unified(0)
      .ignoreAllSpace()
      .exitCode()
      .diffFilter("ACM")
      .commits("origin/main")
      .paths("packages")
      .argv(),
    [
      "git",
      "diff",
      "--staged",
      "--stat",
      "--unified=0",
      "--ignore-all-space",
      "--exit-code",
      "--diff-filter=ACM",
      "origin/main",
      "--",
      "packages",
    ],
  );
});

Deno.test("diff: --name-only is rendered after the other formats", () => {
  // `diffNames` pins `--name-only`; rendering it last means a lambda that also
  // asked for `--stat` still yields paths rather than a summary git would
  // otherwise apply instead.
  assertEquals(
    new GitDiffSettings().stat().nameStatus().nameOnly().nulTerminated().argv(),
    ["git", "diff", "--stat", "--name-status", "--name-only", "-z"],
  );
});

Deno.test("diff: a three-dot range diffs against the merge base", () => {
  assertEquals(
    new GitDiffSettings().mergeBase("origin/main").argv(),
    ["git", "diff", "origin/main...HEAD"],
  );
  assertEquals(
    new GitDiffSettings().mergeBase("origin/main", "feature").argv(),
    ["git", "diff", "origin/main...feature"],
  );
});

Deno.test("ls-files renders its selectors", () => {
  assertEquals(
    new GitLsFilesSettings().others().excludeStandard().directory()
      .nulTerminated().paths("src").argv(),
    [
      "git",
      "ls-files",
      "--others",
      "--exclude-standard",
      "--directory",
      "-z",
      "--",
      "src",
    ],
  );
  assertEquals(
    new GitLsFilesSettings().cached().modified().deleted().stage().argv(),
    ["git", "ls-files", "--cached", "--modified", "--deleted", "--stage"],
  );
  // git only reports ignored files as a filter over an untracked listing.
  assertThrows(
    () => new GitLsFilesSettings().ignored().argv(),
    Error,
    ".others()",
  );
});

Deno.test("rev-parse renders its resolution flags", () => {
  assertEquals(
    new GitRevParseSettings().verify().short().rev("HEAD").argv(),
    ["git", "rev-parse", "--verify", "--short", "HEAD"],
  );
  assertEquals(
    new GitRevParseSettings().short(12).abbrevRef().rev("HEAD").argv(),
    ["git", "rev-parse", "--short=12", "--abbrev-ref", "HEAD"],
  );
  assertEquals(
    new GitRevParseSettings().gitDir().showToplevel().showPrefix()
      .isInsideWorkTree().argv(),
    [
      "git",
      "rev-parse",
      "--git-dir",
      "--show-toplevel",
      "--show-prefix",
      "--is-inside-work-tree",
    ],
  );
});

Deno.test("describe renders its tag selection", () => {
  assertEquals(
    new GitDescribeSettings().tags().abbrev(0).match("v*").commitish("HEAD~2")
      .argv(),
    ["git", "describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD~2"],
  );
  assertEquals(
    new GitDescribeSettings().all().always().exactMatch().dirty().argv(),
    ["git", "describe", "--all", "--always", "--exact-match", "--dirty"],
  );
  assertEquals(
    new GitDescribeSettings().dirty("-modified").argv(),
    ["git", "describe", "--dirty=-modified"],
  );
  // `--dirty` describes the working tree; git rejects a commit alongside it.
  assertThrows(
    () => new GitDescribeSettings().dirty().commitish("HEAD").argv(),
    Error,
    "--dirty",
  );
});

Deno.test("splitNul drops the terminator git leaves behind", () => {
  assertEquals(splitNul("a.ts\0b.ts\0"), ["a.ts", "b.ts"]);
  assertEquals(splitNul(""), []);
  // A path may contain anything but a NUL — a newline included.
  assertEquals(splitNul("we ird\nname.ts\0"), ["we ird\nname.ts"]);
});

Deno.test("parseLogEntries reads the pinned record format", () => {
  const record = (fields: string[]) => fields.join("\x1f") + "\x1e";
  const stdout = record([
    "1111111111111111111111111111111111111111",
    "1111111",
    "2222222222222222222222222222222222222222 3333333333333333333333333333333333333333",
    "A Dev",
    "dev@example.test",
    "2026-01-02T03:04:05+02:00",
    "2026-01-02T03:05:05+02:00",
    "feat(core): add a thing",
    "The body.\n\nCloses #1\n\n",
  ]) +
    "\n" +
    record([
      "4444444444444444444444444444444444444444",
      "4444444",
      "",
      "Another Dev",
      "other@example.test",
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
      "chore: root commit",
      "",
    ]);
  const entries = parseLogEntries(stdout);
  assertEquals(entries.length, 2);
  assertEquals(entries[0]?.commit, "1".repeat(40));
  assertEquals(entries[0]?.shortCommit, "1111111");
  assertEquals(entries[0]?.parents, ["2".repeat(40), "3".repeat(40)]);
  assertEquals(entries[0]?.authorName, "A Dev");
  assertEquals(entries[0]?.authorEmail, "dev@example.test");
  assertEquals(entries[0]?.authoredAt, "2026-01-02T03:04:05+02:00");
  assertEquals(entries[0]?.committedAt, "2026-01-02T03:05:05+02:00");
  assertEquals(entries[0]?.subject, "feat(core): add a thing");
  assertEquals(entries[0]?.body, "The body.\n\nCloses #1");
  // The root commit has no parents and an empty body.
  assertEquals(entries[1]?.parents, []);
  assertEquals(entries[1]?.body, "");
});

Deno.test("parseLogEntries skips what it cannot read", () => {
  assertEquals(parseLogEntries(""), []);
  assertEquals(parseLogEntries("\n"), []);
  // A truncated record is dropped rather than reported half-filled.
  assertEquals(parseLogEntries("abc\x1fdef\x1e"), []);
});

Deno.test("LOG_ENTRY_FORMAT separates fields and records, not lines", () => {
  // A commit message contains newlines; these two separators cannot appear in
  // one, which is the whole reason the format is pinned.
  assertEquals(LOG_ENTRY_FORMAT.includes("%x1f"), true);
  assertEquals(LOG_ENTRY_FORMAT.endsWith("%x1e"), true);
});

Deno.test("parseStatusEntries reads the porcelain -z records", () => {
  const stdout = " M packages/git/mod.ts\0" +
    "?? new file.ts\0" +
    "A  added.ts\0";
  assertEquals(parseStatusEntries(stdout), [
    { index: " ", workingTree: "M", path: "packages/git/mod.ts" },
    { index: "?", workingTree: "?", path: "new file.ts" },
    { index: "A", workingTree: " ", path: "added.ts" },
  ]);
  assertEquals(parseStatusEntries(""), []);
});

Deno.test("parseStatusEntries pairs a rename with the path it came from", () => {
  // A rename spends two records: the new path, then the old one.
  const stdout = "R  new.ts\0old.ts\0 M other.ts\0";
  assertEquals(parseStatusEntries(stdout), [
    { index: "R", workingTree: " ", path: "new.ts", originalPath: "old.ts" },
    { index: " ", workingTree: "M", path: "other.ts" },
  ]);
  // A truncated read leaves the second record missing; the entry still stands.
  assertEquals(parseStatusEntries("C  copy.ts\0"), [
    { index: "C", workingTree: " ", path: "copy.ts" },
  ]);
  // A record too short to hold a path is not an entry.
  assertEquals(parseStatusEntries("M\0"), []);
});

Deno.test("statusEntries refuses the --branch header it cannot parse", async () => {
  await assertRejects(
    () => GitTasks.statusEntries((s) => s.branch()),
    Error,
    "header record",
  );
});

Deno.test("lsFileNames refuses the --stage listing it cannot parse", async () => {
  await assertRejects(
    () => GitTasks.lsFileNames((s) => s.stage()),
    Error,
    ".stage()",
  );
});

Deno.test("the reading tasks fail on a missing git rather than parsing nothing", async () => {
  await assertRejects(
    () => GitTasks.statusEntries((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GitTasks.logEntries((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GitTasks.diffNames((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GitTasks.lsFileNames((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GitTasks.revision((s) => missingTool(s).rev("HEAD")),
    ToolNotFoundError,
  );
});

Deno.test("statusEntries and its settings share the porcelain form", () => {
  // The parse depends on `--porcelain -z`, so the settings must be able to
  // render exactly that shape.
  assertEquals(
    new GitStatusSettings().porcelain().nulTerminated().untrackedFiles("all")
      .ignored().paths("src").argv(),
    [
      "git",
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
      "--ignored",
      "--",
      "src",
    ],
  );
});
