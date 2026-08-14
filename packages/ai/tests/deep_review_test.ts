// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { AiReviewError, genericReviewer, securityReviewer } from "../mod.ts";
import { changedPaths } from "../src/diff.ts";
import { buildFileContext } from "../src/file_context.ts";
import { findingFingerprint } from "../src/suppress.ts";
import { captureLines } from "../../core/tests/_console.ts";
import { withEnv } from "../../core/tests/_env.ts";

const DIFF = "diff --git a/src/app.ts b/src/app.ts\n" +
  "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n+const x = eval(input);\n";

/** A recorded fetch call with its URL and request body. */
interface Call {
  url: string;
  body: string;
}

/** Wrap a payload in a Claude Messages-API response. */
function claude(payload: unknown): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(payload) }],
    stop_reason: "end_turn",
  });
}

/**
 * A fake `fetch` that serves provider calls from a queue — first call gets
 * `responses[0]`, second `responses[1]`, … — recording each call. An entry can
 * be `{ status }` to simulate an API failure.
 */
function queuedFetch(
  responses: Array<string | { status: number }>,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url: String(input), body });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (typeof next === "string") {
      return Promise.resolve(new Response(next, { status: 200 }));
    }
    return Promise.resolve(new Response("err", { status: next.status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/** A git seam serving a diff, `git show` file reads, and recording argv. */
function fakeGit(
  files: Record<string, string>,
  diff = DIFF,
): { run: (argv: string[]) => Promise<string>; calls: string[][] } {
  const calls: string[][] = [];
  const run = (argv: string[]) => {
    calls.push(argv);
    if (argv[1] === "diff") return Promise.resolve(diff);
    if (argv[1] === "show") {
      const content = files[argv[2]];
      return content !== undefined
        ? Promise.resolve(content)
        : Promise.reject(new Error(`fatal: bad object ${argv[2]}`));
    }
    return Promise.reject(new Error(`unexpected git call: ${argv.join(" ")}`));
  };
  return { run, calls };
}

// ─── changedPaths / buildFileContext ────────────────────────────────────────

Deno.test("changedPaths lists post-image paths once, skipping deletions", () => {
  const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@\n+1\n" +
    "diff --git a/gone.ts b/gone.ts\n--- a/gone.ts\n+++ /dev/null\n@@\n-x\n" +
    "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@\n+2\n" +
    "diff --git a/dir/b.ts b/dir/b.ts\n--- a/dir/b.ts\n+++ b/dir/b.ts\n@@\n+3\n";
  assertEquals(changedPaths(diff), ["a.ts", "dir/b.ts"]);
  assertEquals(changedPaths("not a diff"), []);
});

Deno.test("buildFileContext reads files at HEAD within the budget", async () => {
  const { run, calls } = fakeGit({
    "HEAD:a.ts": "aaaa".repeat(100), // 400 chars
    "HEAD:b.ts": "bbbb".repeat(100),
    "HEAD:c.ts": "cccc".repeat(100),
  });
  // 150 tokens ≈ 600 chars: a.ts whole, b.ts truncated, c.ts omitted.
  const context = await buildFileContext(["a.ts", "b.ts", "c.ts"], run, 150);
  assertEquals(context.includes("--- a.ts ---"), true);
  assertEquals(context.includes("… (file truncated) …"), true);
  assertEquals(context.includes("(omitted for budget: c.ts)"), true);
  // Only a.ts and b.ts were read — the budget was spent before c.ts, so it is
  // never fetched at all.
  assertEquals(calls.length, 2);
  assertEquals(calls.every((c) => c[0] === "git" && c[1] === "show"), true);
});

Deno.test("buildFileContext skips unreadable files and can come up empty", async () => {
  const { run } = fakeGit({});
  assertEquals(await buildFileContext(["missing.ts"], run, 100), "");
});

// ─── conventionsFile ────────────────────────────────────────────────────────

Deno.test("conventionsFile reads from the diff BASE ref, not the head", async () => {
  const { fetch, calls } = queuedFetch([claude({ score: 0, findings: [] })]);
  const git = fakeGit({
    "origin/master:AGENTS.md": "# Conventions\nNever use `any`.",
  });
  await genericReviewer((r) =>
    r.provider("claude").apiKey("k").quiet()
      .diff((d) => d.base("origin/master"))
      .conventionsFile("AGENTS.md")
      .exec(git.run).fetch(fetch)
  ).validate({ target: "t" });
  // The read went through git at the base ref — the PR head can't supply it.
  assertEquals(
    git.calls.some((c) =>
      c[1] === "show" && c[2] === "origin/master:AGENTS.md"
    ),
    true,
  );
  const body = JSON.parse(calls[0].body);
  assertEquals(body.system.includes("PROJECT_CONVENTIONS"), true);
  assertEquals(body.system.includes("reference material"), true);
  const user = body.messages[0].content;
  assertEquals(user.includes("<<<PROJECT_CONVENTIONS"), true);
  assertEquals(user.includes("Never use `any`."), true);
});

Deno.test("an unreadable conventions file warns and reviews without it", async () => {
  const { fetch, calls } = queuedFetch([claude({ score: 0, findings: [] })]);
  const git = fakeGit({}); // git show fails
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warnings.push(a.join(" "));
  try {
    await genericReviewer((r) =>
      r.provider("claude").apiKey("k")
        .diff((d) => d.base("origin/master"))
        .conventionsFile("AGENTS.md")
        .exec(git.run).fetch(fetch)
    ).validate({ target: "t" });
  } finally {
    console.warn = warn;
  }
  assertEquals(
    warnings.some((w) => w.includes("could not read AGENTS.md")),
    true,
  );
  const user = JSON.parse(calls[0].body).messages[0].content;
  assertEquals(user.includes("PROJECT_CONVENTIONS"), false);
});

Deno.test("conventionsFile without a base ref reads from disk, and truncates", async () => {
  const file = await Deno.makeTempFile({ suffix: ".md" });
  try {
    await Deno.writeTextFile(file, "rule ".repeat(200)); // 1000 chars
    const { fetch, calls } = queuedFetch([claude({ score: 0, findings: [] })]);
    await genericReviewer((r) =>
      r.provider("claude").apiKey("k").quiet()
        .diff((d) => d.text(DIFF))
        .conventionsFile(file, 100) // ≈400 chars — forces the cut
        .fetch(fetch)
    ).validate({ target: "t" });
    const user = JSON.parse(calls[0].body).messages[0].content;
    assertEquals(user.includes("rule rule"), true);
    assertEquals(
      user.includes(
        "… (conventions document truncated to fit the token budget) …",
      ),
      true,
    );
  } finally {
    await Deno.remove(file);
  }
});

// ─── fileContext ────────────────────────────────────────────────────────────

Deno.test("fileContext feeds changed-file contents to review AND verify", async () => {
  const finding = {
    title: "Unvalidated eval",
    severity: "high",
    file: "src/app.ts",
    detail: "input flows to eval",
  };
  const { fetch, calls } = queuedFetch([
    claude({ score: 8, severity: "high", findings: [finding] }),
    claude({ verdicts: [] }), // verifier returns nothing — findings kept
  ]);
  const git = fakeGit({
    "HEAD:src/app.ts": "export const guard = validate(input);",
  });
  await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet()
          .diff((d) => d.base("origin/master"))
          .fileContext(1000).verify()
          .exec(git.run).fetch(fetch)
      ).validate({ target: "t" }),
    AiReviewError, // no verdict for the finding → kept → default gate trips at 8
  );
  const review = JSON.parse(calls[0].body);
  assertEquals(review.system.includes("UNTRUSTED_FILES"), true);
  assertEquals(
    review.messages[0].content.includes(
      "export const guard = validate(input);",
    ),
    true,
  );
  // The verify pass sees the same file context.
  const verify = JSON.parse(calls[1].body);
  assertEquals(
    verify.messages[0].content.includes(
      "export const guard = validate(input);",
    ),
    true,
  );
});

// ─── verify pass ────────────────────────────────────────────────────────────

Deno.test("verify refutes a candidate: reported as refuted, not gated on", async () => {
  const findings = [
    { title: "SQL injection", severity: "high", file: "db.ts" },
    { title: "Missing null check", severity: "low", file: "app.ts" },
  ];
  // Compute the ids the reviewer will assign, to answer with matching verdicts.
  const idHigh = findingFingerprint("security", {
    title: "SQL injection",
    severity: "high",
    file: "db.ts",
  });
  const idLow = findingFingerprint("security", {
    title: "Missing null check",
    severity: "low",
    file: "app.ts",
  });
  const { fetch, calls } = queuedFetch([
    claude({ score: 8, severity: "high", findings }),
    // The verifier refutes the high finding and confirms the low one.
    claude({
      verdicts: [
        { id: idHigh, verdict: "refuted", reason: "query is parameterised" },
        { id: idLow, verdict: "confirmed", reason: "path traced" },
      ],
    }),
  ]);

  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  const summary = Deno.env.get("GITHUB_STEP_SUMMARY");
  Deno.env.delete("GITHUB_STEP_SUMMARY");
  try {
    // Default gate is score > 7: passing proves the refuted high-severity
    // finding stopped gating (score recomputed from the surviving low one).
    await securityReviewer((r) =>
      r.provider("claude").apiKey("k")
        .diff((d) => d.text(DIFF)).verify()
        .fetch(fetch)
    ).validate({ target: "t" });
  } finally {
    console.log = log;
    if (summary !== undefined) Deno.env.set("GITHUB_STEP_SUMMARY", summary);
  }
  assertEquals(calls.length, 2); // review + verify, no more
  const verify = JSON.parse(calls[1].body);
  assertEquals(verify.system.includes("REFUTE"), true);
  assertEquals(verify.messages[0].content.includes(idHigh), true);
  // The console report keeps the audit trail.
  assertEquals(
    lines.some((l) =>
      l.includes("refuted by verify") && l.includes("SQL injection")
    ),
    true,
  );
  assertEquals(
    lines.some((l) => l.includes("Missing null check")),
    true,
  );
});

Deno.test("a failed verify pass keeps the unverified findings (fail toward reporting)", async () => {
  const { fetch } = queuedFetch([
    claude({
      score: 9,
      severity: "critical",
      findings: [{ title: "RCE", severity: "critical" }],
    }),
    { status: 500 },
  ]);
  await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet()
          .retry({ attempts: 1 })
          .diff((d) => d.text(DIFF)).verify()
          .fetch(fetch)
      ).validate({ target: "t" }),
    AiReviewError, // the finding stayed, so the gate still trips
  );
});

Deno.test("verify is skipped cleanly when there are no findings", async () => {
  const { fetch, calls } = queuedFetch([claude({ score: 0, findings: [] })]);
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet()
      .diff((d) => d.text(DIFF)).verify()
      .fetch(fetch)
  ).validate({ target: "t" });
  assertEquals(calls.length, 1); // no second call to verify nothing
});

/** Capture console output with the job-summary file unset (no real writes). */
const captured = (fn: () => Promise<void>): Promise<string[]> =>
  captureLines(() => withEnv({ GITHUB_STEP_SUMMARY: undefined }, fn));

Deno.test("verify candidates carry the finding's line; a reason-less refutation renders bare", async () => {
  const finding = {
    title: "SQL injection",
    severity: "high",
    file: "db.ts",
    line: 3,
  };
  const id = findingFingerprint("security", {
    title: "SQL injection",
    severity: "high",
    file: "db.ts",
  });
  const { fetch, calls } = queuedFetch([
    claude({ score: 8, severity: "high", findings: [finding] }),
    // A refutation with no reason — schema-valid, and must still narrow.
    claude({ verdicts: [{ id, verdict: "refuted" }] }),
  ]);
  const lines = await captured(() =>
    // Passes: the sole finding was refuted, so the score recomputes to 0.
    securityReviewer((r) =>
      r.provider("claude").apiKey("k")
        .diff((d) => d.text(DIFF)).verify()
        .fetch(fetch)
    ).validate({ target: "t" })
  );
  // The verify prompt carried the line, so the verifier can find the code.
  const verify = JSON.parse(calls[1].body);
  assertEquals(verify.messages[0].content.includes('"line": 3'), true);
  // The refutation is reported without inventing a reason.
  const refutedLine = lines.find((l) => l.includes("refuted by verify"));
  assertEquals(refutedLine?.includes("SQL injection"), true);
  assertEquals(refutedLine?.includes("—"), false);
});

Deno.test("a failed verify pass warns on the console when not quiet", async () => {
  const { fetch } = queuedFetch([
    claude({
      score: 9,
      severity: "critical",
      findings: [{ title: "RCE", severity: "critical" }],
    }),
    { status: 500 },
  ]);
  const lines = await captured(async () => {
    await assertRejects(
      () =>
        securityReviewer((r) =>
          r.provider("claude").apiKey("k")
            .retry({ attempts: 1 })
            .diff((d) => d.text(DIFF)).verify()
            .fetch(fetch)
        ).validate({ target: "t" }),
      AiReviewError, // the unverified finding stayed and still gates
    );
  });
  assertEquals(
    lines.some((l) =>
      l.includes("verify pass failed") &&
      l.includes("keeping unverified findings")
    ),
    true,
  );
});

Deno.test("an empty file context is omitted from the prompt entirely", async () => {
  const { fetch, calls } = queuedFetch([claude({ score: 0, findings: [] })]);
  const git = fakeGit({}); // every `git show` fails — nothing to send
  await genericReviewer((r) =>
    r.provider("claude").apiKey("k").quiet()
      .diff((d) => d.base("origin/master"))
      .fileContext(1000)
      .exec(git.run).fetch(fetch)
  ).validate({ target: "t" });
  const body = JSON.parse(calls[0].body);
  // No empty UNTRUSTED_FILES block confuses the model when nothing was read.
  assertEquals(body.messages[0].content.includes("UNTRUSTED_FILES"), false);
});
