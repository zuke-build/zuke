// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GhPrChecksSettings,
  GhPrCloseSettings,
  GhPrCommentSettings,
  GhPrCreateSettings,
  GhPrEditSettings,
  GhPrListSettings,
  GhPrMergeSettings,
  GhPrViewSettings,
  PR_LIST_FIELDS,
} from "../mod.ts";
import { parsePullRequests } from "../src/pr.ts";

Deno.test("the command path leads, then --repo, then the command's flags", () => {
  // `--repo` is the package's existing placement; a typed command adds its own
  // flags after it rather than replacing the layout.
  assertEquals(
    new GhPrListSettings().repo("acme/app").state("open").limit(50)
      .argv().slice(1),
    ["pr", "list", "--repo", "acme/app", "--state", "open", "--limit", "50"],
  );
});

Deno.test("pr create renders its flags", () => {
  assertEquals(
    new GhPrCreateSettings()
      .title("feat: thing")
      .body("why")
      .base("main")
      .head("feature")
      .draft()
      .assignee("@me")
      .label("enhancement")
      .reviewer("someone")
      .project("Roadmap")
      .milestone("v2")
      .templateFile(".github/pull_request_template.md")
      .argv()
      .slice(1),
    [
      "pr",
      "create",
      "--title",
      "feat: thing",
      "--body",
      "why",
      "--base",
      "main",
      "--head",
      "feature",
      "--draft",
      "--assignee",
      "@me",
      "--label",
      "enhancement",
      "--reviewer",
      "someone",
      "--project",
      "Roadmap",
      "--milestone",
      "v2",
      "--template",
      ".github/pull_request_template.md",
    ],
  );
});

Deno.test("pr create refuses two sources for the same text", () => {
  // gh takes one; silently preferring one would hide which body was posted.
  assertThrows(
    () => new GhPrCreateSettings().body("a").bodyFile("b.md").argv(),
    Error,
    "GhTasks.prCreate: .body(...) and .bodyFile(...) are two sources",
  );
  assertThrows(
    () => new GhPrCreateSettings().fill().fillFirst().argv(),
    Error,
    "GhTasks.prCreate: .fill(), .fillFirst(), and .fillVerbose()",
  );
});

Deno.test("pr create renders its fill modes and its rehearsal", () => {
  // gh's three --fill spellings differ in what they take from the commits, so
  // each is its own flag rather than an argument to one.
  assertEquals(
    new GhPrCreateSettings().title("t").fillVerbose().dryRun()
      .noMaintainerEdit().argv().slice(1),
    [
      "pr",
      "create",
      "--title",
      "t",
      "--fill-verbose",
      "--dry-run",
      "--no-maintainer-edit",
    ],
  );
  assertEquals(
    new GhPrCreateSettings().fill().argv().slice(1),
    ["pr", "create", "--fill"],
  );
  assertEquals(
    new GhPrCreateSettings().fillFirst().argv().slice(1),
    ["pr", "create", "--fill-first"],
  );
});

Deno.test("pr list renders every filter", () => {
  assertEquals(
    new GhPrListSettings()
      .state("merged")
      .base("main")
      .head("feature")
      .author("someone")
      .app("dependabot")
      .assignee("@me")
      .label("bug")
      .label("ci")
      .search("sort:updated")
      .draft()
      .limit(10)
      .json("number", "title")
      .jq(".[].number")
      .argv()
      .slice(1),
    [
      "pr",
      "list",
      "--state",
      "merged",
      "--base",
      "main",
      "--head",
      "feature",
      "--author",
      "someone",
      "--app",
      "dependabot",
      "--assignee",
      "@me",
      "--label",
      "bug",
      "--label",
      "ci",
      "--search",
      "sort:updated",
      "--draft",
      "--limit",
      "10",
      "--json",
      "number,title",
      "--jq",
      ".[].number",
    ],
  );
});

Deno.test("the pull request operand is optional, as it is on the command line", () => {
  // gh falls back to the PR for the current branch.
  assertEquals(new GhPrViewSettings().argv().slice(1), ["pr", "view"]);
  assertEquals(
    new GhPrViewSettings().selector(123).comments().argv().slice(1),
    ["pr", "view", "123", "--comments"],
  );
  assertEquals(
    new GhPrViewSettings().selector("feature-branch").argv().slice(1),
    ["pr", "view", "feature-branch"],
  );
  assertEquals(new GhPrMergeSettings().squash().argv().slice(1), [
    "pr",
    "merge",
    "--squash",
  ]);
});

Deno.test("pr merge renders each method and its guards", () => {
  assertEquals(
    new GhPrMergeSettings().selector(123).squash().deleteBranch()
      .subject("feat: thing").body("notes").matchHeadCommit("abc123")
      .authorEmail("ci@example.test").argv().slice(1),
    [
      "pr",
      "merge",
      "123",
      "--squash",
      "--delete-branch",
      "--subject",
      "feat: thing",
      "--body",
      "notes",
      "--author-email",
      "ci@example.test",
      "--match-head-commit",
      "abc123",
    ],
  );
  assertEquals(
    new GhPrMergeSettings().merge().auto().argv().slice(1),
    ["pr", "merge", "--merge", "--auto"],
  );
  assertEquals(
    new GhPrMergeSettings().rebase().admin().argv().slice(1),
    ["pr", "merge", "--rebase", "--admin"],
  );
  assertThrows(
    () => new GhPrMergeSettings().auto().disableAuto().argv(),
    Error,
    "GhTasks.prMerge: .auto() enables auto-merge",
  );
  assertEquals(
    new GhPrMergeSettings().selector(123).disableAuto().argv().slice(1),
    ["pr", "merge", "123", "--disable-auto"],
  );
});

Deno.test("pr checks keeps the watch-only flags to watching", () => {
  assertEquals(
    new GhPrChecksSettings().selector(123).required().argv().slice(1),
    ["pr", "checks", "123", "--required"],
  );
  assertEquals(
    new GhPrChecksSettings().watch().failFast().interval(5).argv().slice(1),
    ["pr", "checks", "--watch", "--fail-fast", "--interval", "5"],
  );
  // gh ignores them without --watch, which would leave a build believing it
  // had asked for something it had not.
  assertThrows(
    () => new GhPrChecksSettings().failFast().argv(),
    Error,
    "GhTasks.prChecks: .failFast()/.interval(...) describe how to watch",
  );
});

Deno.test("pr comment renders its edit and delete modes", () => {
  assertEquals(
    new GhPrCommentSettings().selector(123).body("CI is green").argv().slice(1),
    ["pr", "comment", "123", "--body", "CI is green"],
  );
  assertEquals(
    new GhPrCommentSettings().selector(123).body("updated").editLast()
      .createIfNone().argv().slice(1),
    [
      "pr",
      "comment",
      "123",
      "--body",
      "updated",
      "--edit-last",
      "--create-if-none",
    ],
  );
  assertEquals(
    new GhPrCommentSettings().selector(123).deleteLast().yes().argv().slice(1),
    ["pr", "comment", "123", "--delete-last", "--yes"],
  );
  // A build cannot answer gh's confirmation prompt.
  assertThrows(
    () => new GhPrCommentSettings().selector(1).deleteLast().argv(),
    Error,
    "GhTasks.prComment: .deleteLast() prompts for confirmation",
  );
  assertThrows(
    () => new GhPrCommentSettings().selector(1).createIfNone().argv(),
    Error,
    "GhTasks.prComment: .createIfNone() qualifies .editLast()",
  );
});

Deno.test("pr edit renders every add and remove", () => {
  assertEquals(
    new GhPrEditSettings()
      .selector(123)
      .title("new title")
      .body("new body")
      .base("main")
      .addLabel("ready")
      .removeLabel("wip")
      .addAssignee("@me")
      .removeAssignee("other")
      .addReviewer("someone")
      .removeReviewer("nobody")
      .addProject("Roadmap")
      .removeProject("Backlog")
      .milestone("v2")
      .argv()
      .slice(1),
    [
      "pr",
      "edit",
      "123",
      "--title",
      "new title",
      "--body",
      "new body",
      "--base",
      "main",
      "--add-label",
      "ready",
      "--remove-label",
      "wip",
      "--add-assignee",
      "@me",
      "--remove-assignee",
      "other",
      "--add-reviewer",
      "someone",
      "--remove-reviewer",
      "nobody",
      "--add-project",
      "Roadmap",
      "--remove-project",
      "Backlog",
      "--milestone",
      "v2",
    ],
  );
  assertEquals(
    new GhPrEditSettings().selector(1).removeMilestone().argv().slice(1),
    ["pr", "edit", "1", "--remove-milestone"],
  );
  assertThrows(
    () => new GhPrEditSettings().milestone("v2").removeMilestone().argv(),
    Error,
    "GhTasks.prEdit: .milestone(...) sets one",
  );
});

Deno.test("pr close renders its comment and branch cleanup", () => {
  assertEquals(
    new GhPrCloseSettings().selector(123).comment("superseded").deleteBranch()
      .argv().slice(1),
    ["pr", "close", "123", "--comment", "superseded", "--delete-branch"],
  );
  assertEquals(new GhPrCloseSettings().argv().slice(1), ["pr", "close"]);
});

Deno.test("parsePullRequests reads gh's JSON array", () => {
  const stdout = JSON.stringify([
    {
      number: 404,
      title: "feat(docker): …",
      state: "MERGED",
      isDraft: false,
      headRefName: "feature",
      baseRefName: "master",
      url: "https://github.com/o/r/pull/404",
      author: { login: "someone" },
    },
  ]);
  assertEquals(parsePullRequests(stdout), [{
    number: 404,
    title: "feat(docker): …",
    state: "MERGED",
    isDraft: false,
    headRefName: "feature",
    baseRefName: "master",
    url: "https://github.com/o/r/pull/404",
    author: "someone",
  }]);
});

Deno.test("parsePullRequests treats anything but an array of objects as empty", () => {
  // gh prints `[]` for an empty listing, and prose when it has something else
  // to say; neither is a crash.
  assertEquals(parsePullRequests("[]"), []);
  assertEquals(parsePullRequests(""), []);
  assertEquals(parsePullRequests("no pull requests match"), []);
  assertEquals(parsePullRequests('{"number":1}'), []);
  assertEquals(parsePullRequests("[1, 2]"), []);
  // A field gh reports as the wrong type is not that field.
  assertEquals(parsePullRequests('[{"number":"404"}]'), [{}]);
  // An author gh nests without a login yields no author.
  assertEquals(parsePullRequests('[{"author":{}}]'), [{}]);
});

Deno.test("the pinned field set is what the entry documents", () => {
  // gh requires --json fields by name, so the reader's set and the entry's
  // shape have to stay in step.
  assertEquals(PR_LIST_FIELDS.includes("number"), true);
  assertEquals(PR_LIST_FIELDS.includes("author"), true);
  assertEquals(PR_LIST_FIELDS.length, 8);
});
