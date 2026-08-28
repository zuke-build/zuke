// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GhIssueCloseSettings,
  GhIssueCommentSettings,
  GhIssueCreateSettings,
  GhIssueListSettings,
  GhIssueViewSettings,
  ISSUE_LIST_FIELDS,
} from "../mod.ts";
import { parseIssues } from "../src/issue.ts";

Deno.test("issue create renders its flags", () => {
  assertEquals(
    new GhIssueCreateSettings()
      .repo("acme/app")
      .title("flaky test")
      .body("it fails on Windows")
      .assignee("@me")
      .label("bug")
      .label("ci")
      .project("Roadmap")
      .milestone("v2")
      .type("Bug")
      .parent(41)
      .templateName("bug_report.yml")
      .argv()
      .slice(1),
    [
      "issue",
      "create",
      "--repo",
      "acme/app",
      "--title",
      "flaky test",
      "--body",
      "it fails on Windows",
      "--assignee",
      "@me",
      "--label",
      "bug",
      "--label",
      "ci",
      "--project",
      "Roadmap",
      "--milestone",
      "v2",
      "--type",
      "Bug",
      "--parent",
      "41",
      "--template",
      "bug_report.yml",
    ],
  );
});

Deno.test("issue create insists on a title, and on one body", () => {
  // Without --title gh opens a prompt, and a build has no one to answer it.
  assertThrows(
    () => new GhIssueCreateSettings().body("details").argv(),
    Error,
    "GhTasks.issueCreate: .title(...) is required",
  );
  assertThrows(
    () =>
      new GhIssueCreateSettings().title("t").body("a").bodyFile("b.md").argv(),
    Error,
    "GhTasks.issueCreate: .body(...) and .bodyFile(...) are two sources",
  );
  assertEquals(
    new GhIssueCreateSettings().title("t").bodyFile("-").argv().slice(1),
    ["issue", "create", "--title", "t", "--body-file", "-"],
  );
});

Deno.test("issue list renders every filter", () => {
  assertEquals(
    new GhIssueListSettings()
      .state("all")
      .author("someone")
      .app("dependabot")
      .assignee("@me")
      .mention("other")
      .milestone("v2")
      .type("Bug")
      .label("bug")
      .label("ci")
      .search("sort:created")
      .limit(10)
      .json("number", "title")
      .template("{{.number}}")
      .web()
      .argv()
      .slice(1),
    [
      "issue",
      "list",
      "--state",
      "all",
      "--author",
      "someone",
      "--app",
      "dependabot",
      "--assignee",
      "@me",
      "--mention",
      "other",
      "--milestone",
      "v2",
      "--type",
      "Bug",
      "--label",
      "bug",
      "--label",
      "ci",
      "--search",
      "sort:created",
      "--limit",
      "10",
      "--json",
      "number,title",
      "--template",
      "{{.number}}",
      "--web",
    ],
  );
  assertEquals(new GhIssueListSettings().argv().slice(1), ["issue", "list"]);
});

Deno.test("every issue command names its issue", () => {
  // gh has no "issue for the current branch" the way it has a pull request,
  // so the operand is required rather than optional.
  assertEquals(
    new GhIssueViewSettings().selector(42).comments().jq(".title").argv()
      .slice(1),
    ["issue", "view", "42", "--comments", "--jq", ".title"],
  );
  assertThrows(
    () => new GhIssueViewSettings().argv(),
    Error,
    "GhTasks.issueView: .selector(...) is required",
  );
  assertThrows(
    () => new GhIssueCommentSettings().body("hi").argv(),
    Error,
    "GhTasks.issueComment: .selector(...) is required",
  );
  assertThrows(
    () => new GhIssueCloseSettings().argv(),
    Error,
    "GhTasks.issueClose: .selector(...) is required",
  );
});

Deno.test("issue comment renders its edit and delete modes", () => {
  assertEquals(
    new GhIssueCommentSettings().selector(42).body("on it").argv().slice(1),
    ["issue", "comment", "42", "--body", "on it"],
  );
  assertEquals(
    new GhIssueCommentSettings().selector("https://github.com/o/r/issues/42")
      .bodyFile("note.md").editLast().createIfNone().argv().slice(1),
    [
      "issue",
      "comment",
      "https://github.com/o/r/issues/42",
      "--body-file",
      "note.md",
      "--edit-last",
      "--create-if-none",
    ],
  );
  assertEquals(
    new GhIssueCommentSettings().selector(42).deleteLast().yes().argv()
      .slice(1),
    ["issue", "comment", "42", "--delete-last", "--yes"],
  );
  // A build cannot answer gh's confirmation prompt.
  assertThrows(
    () => new GhIssueCommentSettings().selector(42).deleteLast().argv(),
    Error,
    "GhTasks.issueComment: .deleteLast() prompts for confirmation",
  );
  assertThrows(
    () => new GhIssueCommentSettings().selector(42).createIfNone().argv(),
    Error,
    "GhTasks.issueComment: .createIfNone() qualifies .editLast()",
  );
});

Deno.test("issue close renders its reason, and pairs the duplicate with it", () => {
  assertEquals(
    new GhIssueCloseSettings().selector(42).comment("shipped").reason(
      "completed",
    ).argv().slice(1),
    ["issue", "close", "42", "--comment", "shipped", "--reason", "completed"],
  );
  assertEquals(
    new GhIssueCloseSettings().selector(42).reason("duplicate").duplicateOf(7)
      .argv().slice(1),
    ["issue", "close", "42", "--reason", "duplicate", "--duplicate-of", "7"],
  );
  assertEquals(
    new GhIssueCloseSettings().selector(42).reason("not planned").argv()
      .slice(1),
    ["issue", "close", "42", "--reason", "not planned"],
  );
  // gh ignores --duplicate-of under any other reason, so the issue would close
  // as something the build did not ask for.
  assertThrows(
    () => new GhIssueCloseSettings().selector(42).duplicateOf(7).argv(),
    Error,
    'GhTasks.issueClose: .duplicateOf(...) goes with .reason("duplicate")',
  );
  assertThrows(
    () =>
      new GhIssueCloseSettings().selector(42).reason("completed").duplicateOf(7)
        .argv(),
    Error,
    'GhTasks.issueClose: .duplicateOf(...) goes with .reason("duplicate")',
  );
});

Deno.test("parseIssues reads gh's JSON array", () => {
  const stdout = JSON.stringify([
    {
      number: 406,
      title: "feat(gh): typed pr, issue and release commands",
      state: "OPEN",
      url: "https://github.com/o/r/issues/406",
      author: { login: "someone" },
    },
  ]);
  assertEquals(parseIssues(stdout), [{
    number: 406,
    title: "feat(gh): typed pr, issue and release commands",
    state: "OPEN",
    url: "https://github.com/o/r/issues/406",
    author: "someone",
  }]);
});

Deno.test("parseIssues treats anything but an array of objects as empty", () => {
  assertEquals(parseIssues("[]"), []);
  assertEquals(parseIssues("  "), []);
  assertEquals(parseIssues("no issues match your search"), []);
  assertEquals(parseIssues('{"number":1}'), []);
  assertEquals(parseIssues("[null]"), []);
  // A field gh reports as the wrong type is not that field.
  assertEquals(parseIssues('[{"title":42,"state":null}]'), [{}]);
  assertEquals(parseIssues('[{"author":"someone"}]'), [{}]);
});

Deno.test("the pinned issue field set is what the entry documents", () => {
  assertEquals(ISSUE_LIST_FIELDS.includes("number"), true);
  assertEquals(ISSUE_LIST_FIELDS.includes("author"), true);
  assertEquals(ISSUE_LIST_FIELDS.length, 5);
});
