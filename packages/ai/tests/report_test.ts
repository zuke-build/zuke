// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the report renderer: console lines, the job-summary Markdown, and
 * the best-effort step-summary writer.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  consoleLines,
  formatUsage,
  reviewStartLine,
  skipConsoleLine,
  skipMarkdown,
  toMarkdown,
} from "../src/report.ts";
import type { Assessment } from "../src/types.ts";

/** A small assessment with one located, fingerprinted finding. */
const ASSESSMENT: Assessment = {
  score: 6,
  severity: "medium",
  summary: "one real issue",
  findings: [
    {
      title: "sql injection",
      severity: "high",
      file: "db.ts",
      line: 3,
      id: "abc123",
    },
    { title: "vague worry", severity: "low" }, // no id, no location
  ],
};

Deno.test("formatUsage renders only the counts the provider reported", () => {
  assertEquals(formatUsage(undefined), undefined);
  // A usage object with no counts at all is not an empty line — it is nothing.
  assertEquals(formatUsage({}), undefined);
  assertEquals(formatUsage({ inputTokens: 12 }), "12 in");
  assertEquals(
    formatUsage({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }),
    "1 in · 2 out · 3 total",
  );
});

Deno.test("reviewStartLine echoes the gate and the comment flag", () => {
  assertEquals(
    reviewStartLine("sec", {
      target: "deploy",
      provider: "claude",
      model: "m",
      gate: "score>8",
      comment: true,
    }),
    '[sec] reviewing "deploy" — claude/m · gate score>8 · comment',
  );
  assertEquals(
    reviewStartLine("sec", {
      target: "deploy",
      provider: "openai",
      model: "m",
      gate: "none",
      comment: false,
    }).includes("comment"),
    false,
  );
});

Deno.test("consoleLines prints ids and locations only where they exist", () => {
  const lines = consoleLines("sec", ASSESSMENT);
  assertEquals(lines[0], "[sec] score 6/10 (medium) — 2 finding(s)");
  // The located, fingerprinted finding carries both suffixes …
  assertEquals(lines[1], "  - [high] sql injection (db.ts:3) · abc123");
  // … the bare one carries neither.
  assertEquals(lines[2], "  - [low] vague worry");
  assertEquals(lines[3], "  one real issue");
});

Deno.test("consoleLines audits suppressed, refuted, dismissed, and fixed findings", () => {
  const lines = consoleLines("sec", ASSESSMENT, undefined, {
    suppressed: 2,
    suppressedFindings: [
      { title: "muted", severity: "low", file: "a.ts", line: 1, id: "id1" },
      { title: "muted bare", severity: "low" }, // no id, no location
    ],
    refuted: [
      { finding: { title: "not real", severity: "low" }, reason: "guarded" },
      { finding: { title: "unexplained", severity: "low" } }, // no reason
    ],
    dismissed: [
      {
        finding: { title: "argued away", severity: "low" },
        author: "alice",
        reason: "intended",
        rewordedFrom: "earlier words",
      },
      { finding: { title: "quietly gone", severity: "low" } }, // no author/reason
    ],
    fixed: [
      {
        id: "f1",
        title: "fixed one",
        severity: "high",
        status: "open",
        file: "b.ts",
      },
      { id: "f2", title: "fixed bare", severity: "low", status: "open" }, // no file
    ],
    notes: ["a bounded pass"],
  });
  const text = lines.join("\n");
  assertStringIncludes(text, "suppressed 2 finding(s) via the suppress list");
  assertStringIncludes(text, "    suppressed: [low] muted (a.ts:1) · id1");
  assertStringIncludes(text, "    suppressed: [low] muted bare");
  assertStringIncludes(text, "    refuted by verify: not real — guarded");
  assertStringIncludes(text, "    refuted by verify: unexplained");
  assertStringIncludes(
    text,
    '    dismissed via discussion by alice: argued away (reworded from "earlier words") — intended',
  );
  assertStringIncludes(text, "    dismissed via discussion: quietly gone");
  assertStringIncludes(text, "    fixed: fixed one (b.ts) · f1");
  assertStringIncludes(text, "    fixed: fixed bare · f2");
  assertStringIncludes(text, "  note: a bounded pass");
});

Deno.test("toMarkdown fills missing audit fields with an em dash", () => {
  const md = toMarkdown("sec", "deploy", ASSESSMENT, undefined, {
    refuted: [{ finding: { title: "not real", severity: "low" } }],
    dismissed: [{ finding: { title: "quietly gone", severity: "low" } }],
    fixed: [{ id: "f2", title: "fixed bare", severity: "low", status: "open" }],
    notes: ["pass skipped for budget"],
  });
  // A refuted finding with no reason, and a dismissal with no author, reason,
  // or finding id, render as explicit dashes — never as empty cells.
  assertStringIncludes(md, "| not real | — |");
  assertStringIncludes(md, "| quietly gone | — | — | — |");
  // A fixed finding without a file gets a dash location.
  assertStringIncludes(md, "| low | fixed bare | — | f2 |");
  assertStringIncludes(md, "- pass skipped for budget");
});

Deno.test("toMarkdown names the dismisser, the reason, and the rewording", () => {
  const md = toMarkdown("sec", "deploy", ASSESSMENT, undefined, {
    dismissed: [{
      finding: { title: "argued away", severity: "low", id: "d1" },
      author: "alice",
      reason: "intended",
      rewordedFrom: "earlier words",
    }],
  });
  assertStringIncludes(
    md,
    '| argued away _(reworded from "earlier words")_ | alice | intended | d1 |',
  );
});

Deno.test("a newline in a finding title cannot break out of its table row", () => {
  // The reviewer's table row is one line. A title starting with a newline used
  // to end the row and continue as top-level Markdown — a forged "## Approved"
  // heading published inside the reviewer's own comment.
  const md = toMarkdown("sec", "deploy", {
    score: 9,
    severity: "high",
    summary: "s",
    findings: [{ title: "\n## Approved", severity: "high" }],
  });
  assertStringIncludes(md, "| high |  ## Approved | — |");
  assertEquals(md.includes("\n## Approved"), false);
});

Deno.test("skipMarkdown neutralises the reason like any untrusted value", () => {
  const md = skipMarkdown("sec", "deploy", "no <!-- zuke-ai-state:x --> key");
  assertEquals(md.includes("<!--"), false);
  assertStringIncludes(
    md,
    "_Skipped — no &lt;!-- zuke-ai-state:x --&gt; key._",
  );
  assertEquals(skipConsoleLine("sec", "no key"), "[sec] skipped — no key");
});

Deno.test("writeStepSummary is a silent no-op without env access", async () => {
  // The writer is best-effort: in a sandbox that denies env access it must
  // return without throwing — and without writing — even when the variable
  // actually points at a writable file.
  const dir = await Deno.makeTempDir({ prefix: "zuke-report-" });
  const summary = `${dir}/summary.md`;
  const script = `${dir}/probe.ts`;
  const moduleUrl = new URL("../src/report.ts", import.meta.url).href;
  await Deno.writeTextFile(
    script,
    [
      "// Copyright (c) 2026 the Zuke contributors",
      "// SPDX-License-Identifier: MIT",
      `import { writeStepSummary } from "${moduleUrl}";`,
      'writeStepSummary("# never lands");',
      'console.log("survived");',
    ].join("\n"),
  );
  try {
    const output = await new Deno.Command(Deno.execPath(), {
      // No permissions at all: Deno.env.get throws inside writeStepSummary.
      args: ["run", "--quiet", "--no-check", script],
      env: { GITHUB_STEP_SUMMARY: summary, NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(new TextDecoder().decode(output.stdout).trim(), "survived");
    assertEquals(output.code, 0);
    // The summary file was never created — the writer bailed before writing.
    let exists = true;
    try {
      await Deno.stat(summary);
    } catch {
      exists = false;
    }
    assertEquals(exists, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
