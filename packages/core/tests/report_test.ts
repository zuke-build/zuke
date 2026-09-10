// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import {
  closingLine,
  formatDuration,
  jobSummaryMarkdown,
  type Style,
  summaryBlock,
  targetDryRunFooter,
  targetFailFooter,
  targetHeader,
  targetPassFooter,
  type TargetReport,
  targetWaitFooter,
} from "../src/report.ts";

/** Plain (no colour, terminal mode), with a stable width for assertions. */
const PLAIN: Style = { github: false, color: false, width: 40 };
/** GitHub Actions style (no colour, no rules — groups replace headers). */
const GITHUB: Style = { github: true, color: false, width: 40 };
/** Coloured terminal mode — assertions look for ANSI markers (`\x1b[`). */
const COLOR: Style = { github: false, color: true, width: 40 };

const NOW = new Date(2026, 5, 23, 7, 19); // 2026-06-23 07:19 local

Deno.test("formatDuration renders ms as a one-decimal second value", () => {
  assertEquals(formatDuration(0), "0.0s");
  assertEquals(formatDuration(19_300), "19.3s");
});

Deno.test("targetHeader frames the name with two ═ rules in terminal mode", () => {
  const out = targetHeader(PLAIN, "test");
  assertEquals(out.length, 3);
  assertEquals(out[0], "═".repeat(40));
  assertEquals(out[1], "test");
  assertEquals(out[2], "═".repeat(40));
});

Deno.test("targetHeader emits a ::group:: command under GitHub Actions", () => {
  assertEquals(targetHeader(GITHUB, "test"), ["::group::test"]);
});

Deno.test("targetPassFooter says 'succeeded in' and closes the group on Actions", () => {
  assertEquals(targetPassFooter(PLAIN, "test", 1_200), [
    "✔ test succeeded in 1.2s",
  ]);
  assertEquals(targetPassFooter(GITHUB, "test", 1_200), [
    "✔ test succeeded in 1.2s",
    "::endgroup::",
  ]);
});

Deno.test("targetFailFooter routes the failure to stderr and adds a Actions annotation", () => {
  const plain = targetFailFooter(PLAIN, "boom", 500, new Error("nope"));
  assertEquals(plain.info, []);
  assertEquals(plain.error, ["✘ boom failed in 0.5s", "  nope"]);

  const gh = targetFailFooter(GITHUB, "boom", 500, new Error("nope"));
  assertEquals(gh.info, ["::endgroup::"]);
  assertEquals(gh.error, [
    "✘ boom failed in 0.5s",
    "  nope",
    "::error title=boom::boom failed: nope",
  ]);

  // A non-Error throw is coerced via String().
  const str = targetFailFooter(PLAIN, "boom", 0, "string failure");
  assertEquals(str.error[1], "  string failure");
});

Deno.test("targetDryRunFooter marks the target as not executed", () => {
  assertEquals(targetDryRunFooter(PLAIN, "deploy"), [
    "✔ deploy (dry run — not executed)",
  ]);
  assertEquals(targetDryRunFooter(GITHUB, "deploy").length, 2);
});

Deno.test("summaryBlock renders an aligned table with a Total row and closing line", () => {
  const reports = [
    { name: "restore", status: "passed" as const, ms: 50 },
    { name: "test", status: "passed" as const, ms: 19_300 },
    { name: "coverage", status: "skipped" as const, ms: 0 },
  ];
  const lines = summaryBlock(PLAIN, reports, 19_400, true, NOW);
  // Block: blank, title, divider, header, divider, rows..., divider, total, blank, closing.
  assertEquals(lines[0], "");
  assertEquals(lines[1], "Build Summary");
  // Header columns and per-row alignment.
  assertEquals(lines[3].startsWith("Target"), true);
  assertEquals(lines[3].includes("Status"), true);
  assertEquals(lines[3].trimEnd().endsWith("Duration"), true);
  // Rows carry the human status label and right-aligned duration.
  const restore = lines.find((l) => l.startsWith("restore"));
  assertEquals(restore?.includes("Succeeded"), true);
  assertEquals(restore?.trimEnd().endsWith("0.1s"), true);
  // A skipped row shows an em dash (no duration).
  const cov = lines.find((l) => l.startsWith("coverage"));
  assertEquals(cov?.includes("Skipped"), true);
  assertEquals(cov?.trimEnd().endsWith("—"), true);
  // The Total row carries the wall-clock duration.
  const total = lines.find((l) => l.startsWith("Total"));
  assertEquals(total?.trimEnd().endsWith("19.4s"), true);
  // The closing line names the verdict, count, duration, and timestamp.
  assertEquals(
    lines[lines.length - 1],
    "✔ Build succeeded — 2/3 targets in 19.4s · 2026-06-23 07:19",
  );
});

Deno.test("closingLine names a single failed target", () => {
  const reports = [
    { name: "first", status: "passed" as const, ms: 100 },
    { name: "boom", status: "failed" as const, ms: 200 },
    { name: "last", status: "skipped" as const, ms: 0 },
  ];
  assertEquals(
    closingLine(PLAIN, reports, 300, false, NOW),
    "✘ Build failed — 'boom' failed after 0.3s · 2026-06-23 07:19",
  );
});

Deno.test("closingLine pluralises when several targets failed", () => {
  const reports = [
    { name: "a", status: "failed" as const, ms: 100 },
    { name: "b", status: "failed" as const, ms: 100 },
  ];
  assertEquals(
    closingLine(PLAIN, reports, 200, false, NOW),
    "✘ Build failed — 2 targets failed after 0.2s · 2026-06-23 07:19",
  );
});

Deno.test("closingLine falls back when nothing failed but the build still didn't succeed", () => {
  // A degenerate case: ok=false with no failed targets (e.g. parameter error
  // upstream, leaving an empty/all-skipped report). Don't claim a culprit.
  assertEquals(
    closingLine(PLAIN, [], 0, false, NOW),
    "✘ Build failed — no target succeeded after 0.0s · 2026-06-23 07:19",
  );
});

Deno.test("colour mode wraps headers, rows, and the closing line in ANSI codes", () => {
  const header = targetHeader(COLOR, "test");
  assertEquals(header[0].includes("\x1b["), true); // top rule painted (dim)
  assertEquals(header[1].includes("\x1b["), true); // name painted (bold cyan)
  const block = summaryBlock(
    COLOR,
    [{ name: "test", status: "passed", ms: 100 }],
    100,
    true,
    NOW,
  );
  assertEquals(block[block.length - 1].includes("\x1b["), true);
});

Deno.test("jobSummaryMarkdown renders an aligned table with a bold Total row", () => {
  const reports = [
    { name: "a", status: "passed" as const, ms: 100 },
    { name: "b", status: "failed" as const, ms: 200 },
    { name: "c", status: "cached" as const, ms: 0 },
  ];
  const md = jobSummaryMarkdown(reports, 300, false);
  assertEquals(md.startsWith("## ❌ Zuke build — 2/3 targets in 0.3s"), true);
  assertEquals(md.includes("| a | ✔ Succeeded | 0.1s |"), true);
  assertEquals(md.includes("| b | ✘ Failed | 0.2s |"), true);
  assertEquals(md.includes("| c | ⊙ Cached | — |"), true);
  assertEquals(md.includes("| **Total** | | **0.3s** |"), true);
});

Deno.test("jobSummaryMarkdown uses ✅ on a successful build", () => {
  const md = jobSummaryMarkdown(
    [{ name: "ok", status: "passed", ms: 0 }],
    0,
    true,
  );
  assertEquals(md.startsWith("## ✅ Zuke build — 1/1 targets in 0.0s"), true);
});

// A workflow command ends at its line break, so any value interpolated into one
// must not be able to introduce a second. A target's failure message embeds a
// subprocess's stderr verbatim (see CommandError), which is not ours to trust.
Deno.test("a failure annotation cannot be broken out of with a newline", () => {
  const hostile = new Error(
    "build failed\n::stop-commands::abc\n::error::forged annotation",
  );
  const out = targetFailFooter(GITHUB, "deploy", 100, hostile);
  const annotation = out.error.find((l) => l.startsWith("::error "));
  assertEquals(annotation !== undefined, true);
  // Exactly one physical line: nothing the message carried became a command.
  // The `::stop-commands::` text itself is still there and is meant to be — a
  // workflow command is only a command at the start of its own line, so once
  // the newlines are encoded it is inert prose the reader can still see.
  assertEquals(annotation?.includes("\n"), false);
  assertEquals(annotation?.split("\n").length, 1);
  // The text survives, percent-encoded per the Actions spec.
  assertStringIncludes(annotation ?? "", "%0A");
  assertStringIncludes(annotation ?? "", "stop-commands");
});

Deno.test("a percent in a failure message cannot spoof an escape", () => {
  // `%` is encoded first, so a literal `%0A` in the input stays literal rather
  // than being handed to the runner as an encoded newline.
  const out = targetFailFooter(GITHUB, "deploy", 100, new Error("done 100%0A"));
  const annotation = out.error.find((l) => l.startsWith("::error "));
  assertStringIncludes(annotation ?? "", "100%250A");
});

Deno.test("an annotation title escapes the property separators too", () => {
  // A property list is comma-separated and colon-terminated, so a name carrying
  // either would otherwise end the title early and inject another property.
  const out = targetFailFooter(GITHUB, "deploy:1,2", 100, new Error("nope"));
  const annotation = out.error.find((l) => l.startsWith("::error "));
  assertStringIncludes(annotation ?? "", "title=deploy%3A1%2C2::");
});

Deno.test("a group header cannot be broken out of either", () => {
  // A fan-out child's name is derived from a runtime list, so it is not
  // guaranteed to be an identifier.
  const [header] = targetHeader(GITHUB, "deploy[a\n::error::forged]");
  assertEquals(header.includes("\n"), false);
  assertStringIncludes(header, "%0A");
});

Deno.test("summaryBlock trails a row's notes after its duration, NUKE-style", () => {
  const reports = [
    {
      name: "test",
      status: "passed" as const,
      ms: 8_100,
      summary: [
        { key: "Tests", value: "837" },
        { key: "Passed", value: "837" },
        { key: "Failed", value: "0" },
      ],
    },
    { name: "pack", status: "passed" as const, ms: 100 },
    { name: "empty", status: "passed" as const, ms: 100, summary: [] },
  ];
  const lines = summaryBlock(PLAIN, reports, 8_300, true, NOW);
  const test = lines.find((l) => l.startsWith("test"));
  assertEquals(
    test?.endsWith("8.1s  // Tests: 837 · Passed: 837 · Failed: 0"),
    true,
  );
  // Rows without notes are unchanged — and the notes do not widen the table.
  const pack = lines.find((l) => l.startsWith("pack"));
  assertEquals(pack?.trimEnd().endsWith("0.1s"), true);
  const empty = lines.find((l) => l.startsWith("empty"));
  assertEquals(empty?.trimEnd().endsWith("0.1s"), true);
  // Target (6) + Succeeded (9) + Duration (8), two spaces between columns.
  assertEquals(lines[2], "─".repeat(6 + 2 + 9 + 2 + 8));
});

Deno.test("summaryBlock dims a row's notes when colour is on", () => {
  const lines = summaryBlock(
    COLOR,
    [{
      name: "test",
      status: "failed",
      ms: 100,
      summary: [{ key: "Failed", value: "1" }],
    }],
    100,
    false,
    NOW,
  );
  const row = lines.find((l) => l.startsWith("test"));
  assertStringIncludes(row ?? "", "\x1b[2m// Failed: 1\x1b[0m");
});

Deno.test("jobSummaryMarkdown adds a Notes column only when some row has notes", () => {
  const md = jobSummaryMarkdown(
    [
      {
        name: "test",
        status: "passed",
        ms: 100,
        summary: [{ key: "Tests", value: "3" }, { key: "Passed", value: "3" }],
      },
      { name: "pack", status: "passed", ms: 200 },
    ],
    300,
    true,
  );
  assertStringIncludes(md, "| Target | Result | Time | Notes |\n");
  assertStringIncludes(md, "| --- | --- | --- | --- |\n");
  assertStringIncludes(
    md,
    "| test | ✔ Succeeded | 0.1s | Tests: 3 · Passed: 3 |",
  );
  assertStringIncludes(md, "| pack | ✔ Succeeded | 0.2s |  |");
  assertStringIncludes(md, "| **Total** | | **0.3s** | |");

  const plain = jobSummaryMarkdown(
    [{ name: "pack", status: "passed", ms: 200 }],
    200,
    true,
  );
  assertEquals(plain.includes("Notes"), false);
  assertStringIncludes(
    plain,
    "| Target | Result | Time |\n| --- | --- | --- |\n",
  );
});

Deno.test("jobSummaryMarkdown escapes a pipe in a note so it cannot add a cell", () => {
  const md = jobSummaryMarkdown(
    [{
      name: "t",
      status: "passed",
      ms: 0,
      summary: [{ key: "Ratio", value: "a | b" }],
    }],
    0,
    true,
  );
  assertStringIncludes(md, "| t | ✔ Succeeded | 0.0s | Ratio: a \\| b |");
});

// --- workflow-command neutralisation on the runner's stream -----------------

/** Every physical line of `lines`, as the Actions runner would split them. */
function physicalLines(lines: readonly string[]): string[] {
  return lines.flatMap((l) => l.split(/\r\n|\r|\n/));
}

/**
 * Zuke's own workflow commands, which are supposed to open with `::`. Their
 * bodies are percent-encoded, so untrusted text cannot break out of them.
 */
const OWN_COMMAND = /^::(?:endgroup::|group::|error title=)/;

/**
 * Whether any physical line would be taken by the runner as a command that
 * Zuke did not intend to emit — the runner trims leading whitespace before
 * testing for `::`, and recognises the legacy `##[...]` form anywhere.
 */
function hasCommandLine(lines: readonly string[]): boolean {
  return physicalLines(lines).some((l) => {
    // Trim what the *runner* considers blank, which includes NEXT LINE and so
    // is wider than this language's `trimStart`. Using the narrower set would
    // give the oracle the same blind spot as the code it checks.
    const trimmed = l.replace(/^[\s\u0085]*/, "");
    if (OWN_COMMAND.test(trimmed)) return false;
    return trimmed.startsWith("::") || l.includes("##[");
  });
}

/** NEXT LINE: whitespace to the runner, not matched by this language's `\s`. */
const NEL = String.fromCharCode(0x85);

Deno.test("a failure message cannot open a workflow command", () => {
  // A CommandError embeds the failed subprocess's stderr verbatim, so this is
  // attacker-influenced whenever a tool echoes repository content. Both runner
  // syntaxes are covered: a `::` line (leading whitespace is trimmed before the
  // test, so indenting defends nothing) and the legacy `##[...]` form, which is
  // recognised anywhere in a line and needs no newline at all.
  const hostile = [
    "Command failed (exit 1): lint",
    "::stop-commands::deadbeef",
    "   ::error::forged",
    "trailing ##[error]forged",
  ].join("\n");
  const { info, error } = targetFailFooter(
    GITHUB,
    "lint",
    5,
    new Error(hostile),
  );

  assertEquals(hasCommandLine(error.slice(0, 2)), false);
  // The text is still there and still readable — only the two sequences the
  // runner acts on are encoded.
  // The leading `::` is encoded, so the line no longer opens a command; the
  // rest of the text is untouched.
  assertStringIncludes(error[1], "%3A%3A" + "stop-commands::deadbeef");
  assertStringIncludes(error[1], "%23%23[error]forged");
  assertStringIncludes(error[1], "Command failed (exit 1): lint");
  // Zuke's own commands still work: the annotation and the group close.
  assertStringIncludes(error[2], "::error title=lint::");
  assertEquals(info, ["::endgroup::"]);
});

Deno.test("plain mode leaves a failure message exactly as it was", () => {
  // Nothing parses a terminal, so encoding there would only hurt legibility.
  const hostile = "boom\n::stop-commands::x\n##[error]y";
  const { error } = targetFailFooter(PLAIN, "lint", 5, new Error(hostile));
  assertStringIncludes(error[1], "::stop-commands::x");
  assertStringIncludes(error[1], "##[error]y");
});

Deno.test("a target name cannot open a workflow command in any footer", () => {
  // A fan-out sub-target's name embeds its item key, which is derived from
  // repository or remote data.
  const name = "build[a\n::stop-commands::x].compile";
  assertEquals(hasCommandLine(targetPassFooter(GITHUB, name, 1)), false);
  assertEquals(hasCommandLine(targetDryRunFooter(GITHUB, name)), false);
  const { error } = targetFailFooter(GITHUB, name, 1, new Error("x"));
  assertEquals(hasCommandLine(error.slice(0, 2)), false);

  // The group header is one of Zuke's own commands, so it opens with `::` by
  // design. What matters there is that the name cannot break out of it: it is
  // percent-encoded into the command body, leaving a single physical line.
  const header = targetHeader(GITHUB, name);
  assertEquals(header.length, 1);
  assertEquals(physicalLines(header).length, 1);
  assertStringIncludes(header[0], "%0A" + "::stop-commands::x");
});

Deno.test("a hostile target name cannot open a command from the summary", () => {
  const reports = [
    { name: "ok", status: "passed", ms: 1 },
    { name: "b\n::stop-commands::x", status: "failed", ms: 2 },
  ] as const;
  const block = summaryBlock(GITHUB, [...reports], 3, false);
  assertEquals(hasCommandLine(block), false);
  // The closing line names the culprit, so it carries the name too.
  assertEquals(
    hasCommandLine([closingLine(GITHUB, [...reports], 3, false, new Date())]),
    false,
  );
});

Deno.test("ordinary output is returned unchanged", () => {
  // The escape must be invisible to every build that is not under attack.
  const plain = summaryBlock(
    PLAIN,
    [{ name: "lint", status: "passed", ms: 1 }],
    1,
    true,
  );
  const github = summaryBlock(
    GITHUB,
    [{ name: "lint", status: "passed", ms: 1 }],
    1,
    true,
  );
  assertEquals(github.filter((l) => l !== "::endgroup::"), plain);
});

Deno.test("a line the runner un-blanks cannot open a command", () => {
  // NEXT LINE is trimmed by the runner before it tests for `::`, and is not
  // matched by this language's `\s`. A line that looks indented here therefore
  // starts with `::` by the time the runner reads it.
  const { error } = targetFailFooter(
    GITHUB,
    "lint",
    1,
    new Error(`boom\n${NEL}::stop-commands::x`),
  );
  assertEquals(hasCommandLine(error.slice(0, 2)), false);
});

Deno.test("a summary note cannot open a command", () => {
  // Notes are parsed out of a tool's own output by the wrapper packages, and
  // the legacy bracketed form needs no newline to be recognised.
  const reports: TargetReport[] = [{
    name: "lint",
    status: "passed",
    ms: 1,
    summary: [{ key: "Files", value: "##[add-mask]hunter2" }],
  }];
  assertEquals(hasCommandLine(summaryBlock(GITHUB, reports, 1, true)), false);
});

Deno.test("a wait footer's trigger cannot open a command", () => {
  // The trigger names what is being waited on — for a workflow gate, a
  // repository and a workflow file.
  assertEquals(
    hasCommandLine(targetWaitFooter(GITHUB, "e2e", "gh:acme/app##[error]x")),
    false,
  );
});

Deno.test("a pipe in a target name cannot add a column to the job summary", () => {
  // The note cell already guarded against this; the name cell did not.
  const md = jobSummaryMarkdown(
    [{ name: "deploy|extra|cells", status: "passed", ms: 1 }],
    1,
    true,
  );
  const row = md.split("\n").find((l) => l.includes("deploy")) ?? "";
  // Leading, name, result, time, trailing — the pipes in the name are escaped
  // rather than opening columns of their own.
  assertEquals(row.split(/(?<!\\)\|/).length, 5);
});
