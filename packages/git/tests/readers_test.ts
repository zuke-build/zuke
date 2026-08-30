// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import { GitTasks } from "../mod.ts";
// The parsers are internal to the package: the public surface is the
// task-shaped GitTasks.refs/treeEntries/blameLines/shortlogEntries, so these
// are imported from their modules rather than re-exported by mod.ts.
import { parseRefs, REF_ENTRY_FORMAT } from "../src/for_each_ref.ts";
import { parseTreeEntries } from "../src/tree.ts";
import { parseBlameLines } from "../src/blame.ts";
import { parseShortlogEntries } from "../src/shortlog.ts";
import { yesNoFromStatus } from "../src/status_answer.ts";

// The fixtures below are git 2.43.0's real output, captured byte-for-byte from
// this repository. The framing each parser depends on — where the NULs fall,
// which records carry a leading newline, the tab before a path — is the part
// that cannot be reasoned out from the documentation.

Deno.test("REF_ENTRY_FORMAT asks for its fields NUL-separated and terminated", () => {
  assertEquals(
    REF_ENTRY_FORMAT,
    "%(objectname)%00%(objecttype)%00%(refname)%00%(upstream)%00",
  );
});

Deno.test("parseRefs: records are separated by the format's NUL then a newline", () => {
  // Captured from `git for-each-ref --format=<REF_ENTRY_FORMAT>`: note the \n
  // that begins every record after the first, which git adds per ref.
  const stdout = "0aa9f75 commit refs/heads/main refs/remotes/origin/main "
    .replaceAll(" ", "\0") +
    "\n25ed95f\0commit\0refs/heads/topic\0\0" +
    "\n5f2e96b\0tag\0refs/tags/v1\0\0";
  assertEquals(parseRefs(stdout), [
    {
      objectName: "0aa9f75",
      objectType: "commit",
      refName: "refs/heads/main",
      upstream: "refs/remotes/origin/main",
    },
    {
      objectName: "25ed95f",
      objectType: "commit",
      refName: "refs/heads/topic",
    },
    { objectName: "5f2e96b", objectType: "tag", refName: "refs/tags/v1" },
  ]);
});

Deno.test("parseRefs: an empty listing and a truncated trailing record", () => {
  assertEquals(parseRefs(""), []);
  // A read cut short mid-record has no complete ref to report.
  assertEquals(parseRefs("0aa9f75\0commit\0"), []);
});

Deno.test("parseTreeEntries: the tab is what makes the path unambiguous", () => {
  // Captured from `git ls-tree -z -r HEAD`.
  const stdout = "100644 blob 998e8a5c\tpackages/git/deno.json\0" +
    "100644 blob 8fbd58c0\tpackages/git/mod.ts\0" +
    "040000 tree 0a1b2c3d\tpackages/git/src\0" +
    "160000 commit deadbeef\tvendor/sub\0";
  assertEquals(parseTreeEntries(stdout), [
    {
      mode: "100644",
      type: "blob",
      objectName: "998e8a5c",
      path: "packages/git/deno.json",
    },
    {
      mode: "100644",
      type: "blob",
      objectName: "8fbd58c0",
      path: "packages/git/mod.ts",
    },
    {
      mode: "040000",
      type: "tree",
      objectName: "0a1b2c3d",
      path: "packages/git/src",
    },
    {
      mode: "160000",
      type: "commit",
      objectName: "deadbeef",
      path: "vendor/sub",
    },
  ]);
});

Deno.test("parseTreeEntries: a path may contain spaces, a mode never does", () => {
  const stdout = "100644 blob 998e8a5c\tdocs/a file with spaces.md\0";
  assertEquals(parseTreeEntries(stdout), [{
    mode: "100644",
    type: "blob",
    objectName: "998e8a5c",
    path: "docs/a file with spaces.md",
  }]);
  // A --name-only listing has no tab, so there is no entry to report.
  assertEquals(parseTreeEntries("packages/git/mod.ts\0"), []);
  assertEquals(parseTreeEntries(""), []);
});

Deno.test("parseBlameLines: metadata is carried forward across a commit's groups", () => {
  // Captured shape from `git blame --porcelain`: the author block appears only
  // on a commit's first group. The second group for f92f929 below carries the
  // header alone, exactly as git emits it.
  const stdout = [
    "f92f929 1 1 1",
    "author Ada Lovelace",
    "author-mail <ada@example.com>",
    "author-time 1786533047",
    "summary the first change",
    "filename AGENTS.md",
    "\tline one",
    "abc1234 2 2 1",
    "author Grace Hopper",
    "author-mail <grace@example.com>",
    "summary the second change",
    "filename AGENTS.md",
    "\tline two",
    "f92f929 3 3 1",
    "\tline three",
  ].join("\n");
  const lines = parseBlameLines(stdout);
  assertEquals(lines.length, 3);
  assertEquals(lines[0]?.author, "Ada Lovelace");
  assertEquals(lines[0]?.authorMail, "ada@example.com");
  assertEquals(lines[1]?.author, "Grace Hopper");
  // The third line names no author in the output; it must still resolve to the
  // one f92f929 declared. A parser reading each record alone reports nothing.
  assertEquals(lines[2]?.author, "Ada Lovelace");
  assertEquals(lines[2]?.summary, "the first change");
  assertEquals(lines[2]?.lineNumber, 3);
  assertEquals(lines[2]?.content, "line three");
});

Deno.test("parseBlameLines: line numbers, content, and an empty annotation", () => {
  const stdout = [
    "f92f929 12 34 2",
    "author Ada",
    "filename a.ts",
    "\t  indented content  ",
    "f92f929 13 35",
    "\t",
  ].join("\n");
  const lines = parseBlameLines(stdout);
  assertEquals(lines.length, 2);
  assertEquals(lines[0]?.originalLineNumber, 12);
  assertEquals(lines[0]?.lineNumber, 34);
  // Only the single leading tab is git's; the rest is the file's own text.
  assertEquals(lines[0]?.content, "  indented content  ");
  assertEquals(lines[1]?.content, "");
  assertEquals(parseBlameLines(""), []);
});

Deno.test("parseShortlogEntries: counts, names, and the -e address", () => {
  // Captured from `git shortlog -sne`: the count is right-aligned in spaces
  // and separated from the name by a tab.
  const stdout = [
    "    44\tTodor Todorov <todor@example.com>",
    "    20\tgithub-actions[bot] <41898282+github-actions[bot]@example.com>",
    "     2\tdependabot[bot]",
  ].join("\n");
  assertEquals(parseShortlogEntries(stdout), [
    { count: 44, name: "Todor Todorov", email: "todor@example.com" },
    {
      count: 20,
      name: "github-actions[bot]",
      email: "41898282+github-actions[bot]@example.com",
    },
    { count: 2, name: "dependabot[bot]" },
  ]);
});

Deno.test("parseShortlogEntries: a name holding angle brackets keeps them", () => {
  // Anchoring on the last " <" is what keeps the name intact.
  const stdout = "     3\tA <weird> Name <real@example.com>";
  assertEquals(parseShortlogEntries(stdout), [{
    count: 3,
    name: "A <weird> Name",
    email: "real@example.com",
  }]);
  // The non-summary format indents subjects under each author; those lines
  // carry no tab-separated count and are not entries.
  assertEquals(parseShortlogEntries("Todor Todorov (2):\n      a commit"), []);
  assertEquals(parseShortlogEntries(""), []);
});

/**
 * Every new task, with the minimum configuration its settings demand, pointed
 * at a binary that cannot exist. Each entry proves the task actually reaches
 * execution — a settings class that never runs would pass its argv test while
 * being unreachable through `GitTasks`.
 */
const REACH: Array<[string, () => Promise<unknown>]> = [
  [
    "mergeBase",
    () => GitTasks.mergeBase((s) => missingTool(s).commits("a", "b")),
  ],
  [
    "isAncestor",
    () => GitTasks.isAncestor((s) => missingTool(s).commits("a", "b")),
  ],
  ["revList", () => GitTasks.revList((s) => missingTool(s).commits("HEAD"))],
  [
    "commitCount",
    () => GitTasks.commitCount((s) => missingTool(s).commits("HEAD")),
  ],
  ["forEachRef", () => GitTasks.forEachRef((s) => missingTool(s))],
  ["refs", () => GitTasks.refs((s) => missingTool(s))],
  ["showRef", () => GitTasks.showRef((s) => missingTool(s))],
  [
    "symbolicRef",
    () => GitTasks.symbolicRef((s) => missingTool(s).name("HEAD")),
  ],
  ["nameRev", () => GitTasks.nameRev((s) => missingTool(s).commits("HEAD"))],
  ["lsTree", () => GitTasks.lsTree((s) => missingTool(s).tree("HEAD"))],
  [
    "treeEntries",
    () => GitTasks.treeEntries((s) => missingTool(s).tree("HEAD")),
  ],
  ["catFile", () => GitTasks.catFile((s) => missingTool(s).object("HEAD"))],
  ["blobText", () => GitTasks.blobText((s) => missingTool(s).object("HEAD"))],
  [
    "checkIgnore",
    () => GitTasks.checkIgnore((s) => missingTool(s).paths("a")),
  ],
  ["isIgnored", () => GitTasks.isIgnored((s) => missingTool(s).paths("a"))],
  ["blame", () => GitTasks.blame((s) => missingTool(s).file("a.ts"))],
  ["blameLines", () => GitTasks.blameLines((s) => missingTool(s).file("a.ts"))],
  ["shortlog", () => GitTasks.shortlog((s) => missingTool(s))],
  ["shortlogEntries", () => GitTasks.shortlogEntries((s) => missingTool(s))],
  ["grep", () => GitTasks.grep((s) => missingTool(s).pattern("a"))],
  [
    "verifyCommit",
    () => GitTasks.verifyCommit((s) => missingTool(s).objects("HEAD")),
  ],
  ["verifyTag", () => GitTasks.verifyTag((s) => missingTool(s).objects("v1"))],
  [
    "isSignatureValid",
    () => GitTasks.isSignatureValid((s) => missingTool(s).objects("HEAD")),
  ],
  [
    "isTagSignatureValid",
    () => GitTasks.isTagSignatureValid((s) => missingTool(s).objects("v1")),
  ],
  [
    "mergeTree",
    () => GitTasks.mergeTree((s) => missingTool(s).branches("a", "b")),
  ],
  [
    "mergesCleanly",
    () => GitTasks.mergesCleanly((s) => missingTool(s).branches("a", "b")),
  ],
];

for (const [name, invoke] of REACH) {
  Deno.test(`GitTasks.${name} reaches execution`, async () => {
    await assertRejects(invoke, ToolNotFoundError);
  });
}

Deno.test("the value-returning readers fail when git is absent", async () => {
  // A reader that swallowed the resolution failure would hand back a confident
  // empty list or a false, which is worse than an error: the boolean readers
  // run with throwing suppressed so a legitimate non-zero status can be read
  // as data, and tool resolution has to stay outside that suppression.
  await assertRejects(
    () => GitTasks.isAncestor((s) => missingTool(s).commits("a", "b")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GitTasks.isIgnored((s) => missingTool(s).paths("a")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GitTasks.mergesCleanly((s) => missingTool(s).branches("a", "b")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => GitTasks.isSignatureValid((s) => missingTool(s).objects("HEAD")),
    ToolNotFoundError,
  );
});

Deno.test("the readers refuse the options that would misreport their result", async () => {
  // A caller-supplied --format moves the fields parseRefs reads by position.
  await assertRejects(
    () => GitTasks.refs((s) => missingTool(s).format("%(refname)")),
    Error,
    "move the fields this reader parses",
  );
  // The single-column ls-tree forms drop the mode and type treeEntries reports.
  await assertRejects(
    () => GitTasks.treeEntries((s) => missingTool(s).tree("HEAD").nameOnly()),
    Error,
    "drops the mode, type and object",
  );
  // An attribute query reports a type or a size, not the contents.
  await assertRejects(
    () => GitTasks.blobText((s) => missingTool(s).object("HEAD").query("type")),
    Error,
    "reports an attribute rather than the contents",
  );
});

Deno.test("a contradiction the caller set still surfaces through the task", async () => {
  // The guards live in subcommandArgs, which the argv is not built from until
  // the task runs — so the refusal arrives as a rejection rather than a throw,
  // and it must still name the fix rather than reaching git as an argv it
  // would reject.
  await assertRejects(
    () => GitTasks.checkIgnore((s) => s.quietOutput().verbose().paths("a")),
    Error,
    "Keep one",
  );
});

// The exit-status readers share one interpreter, so its three-way branch is
// tested once, directly, rather than three times through a fake process.
Deno.test("yesNoFromStatus: 0 is yes, 1 is no, anything else is a failure", () => {
  const ok = { code: 0, stdout: "", stderr: "" };
  const no = { code: 1, stdout: "", stderr: "" };
  const opts = { task: "isAncestor", command: "git merge-base --is-ancestor" };
  assertEquals(yesNoFromStatus(ok, opts), true);
  assertEquals(yesNoFromStatus(no, opts), false);
  // 128 is what git spends on a revision that names no object. Reading it as
  // "no" would turn a typo into an answer the build acts on.
  const failed = assertThrows(
    () => yesNoFromStatus({ code: 128, stdout: "", stderr: "" }, opts),
    Error,
  );
  assertEquals(failed.message.includes("exited 128 without answering"), true);
});

Deno.test("yesNoFromStatus: the failure carries git's own explanation", () => {
  const error = assertThrows(
    () =>
      yesNoFromStatus(
        { code: 128, stdout: "", stderr: "fatal: Not a valid object name x\n" },
        { task: "isAncestor", command: "git merge-base --is-ancestor" },
      ),
    Error,
  );
  assertEquals(error.message.includes("Not a valid object name x"), true);
  // A silent failure still reports the status, without a trailing colon.
  const quiet = assertThrows(
    () =>
      yesNoFromStatus({ code: 3, stdout: "", stderr: "   " }, {
        task: "isIgnored",
        command: "git check-ignore",
      }),
    Error,
  );
  assertEquals(quiet.message.endsWith("rather than a verdict"), true);
});

Deno.test("yesNoFromStatus: merge-tree's 1 means 'no' only with a merge to show", () => {
  const opts = {
    task: "mergesCleanly",
    command: "git merge-tree",
    noRequiresOutput: true,
  };
  // A real conflict writes the merged tree's object name to stdout.
  assertEquals(
    yesNoFromStatus(
      { code: 1, stdout: "4f7cf2aa\n100644 df967b96 1\tf.txt\n", stderr: "" },
      opts,
    ),
    false,
  );
  // A revision git cannot resolve exits 1 with nothing on stdout. Without the
  // stdout check this would read as "the merge conflicts", which is the bug
  // this option exists to prevent.
  const error = assertThrows(
    () =>
      yesNoFromStatus(
        {
          code: 1,
          stdout: "",
          stderr: "merge-tree: nosuchref - not something we can merge\n",
        },
        opts,
      ),
    Error,
  );
  assertEquals(error.message.includes("not something we can merge"), true);
});

Deno.test("parseShortlogEntries: only the count shape git emits is accepted", () => {
  // Found by attacking the parser: Number() accepts "-3" and "1e3" and returns
  // -3 and 1000, neither of which git can produce. A confident wrong number is
  // worse than skipping the row.
  assertEquals(parseShortlogEntries("  -3\tNeg"), []);
  assertEquals(parseShortlogEntries("  1e3\tSci"), []);
  assertEquals(parseShortlogEntries("  0x10\tHex"), []);
  // The real shape still parses, leading spaces and all.
  assertEquals(parseShortlogEntries("     7\tAda"), [{
    count: 7,
    name: "Ada",
  }]);
});
