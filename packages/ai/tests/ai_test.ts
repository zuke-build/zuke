import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import {
  AiReviewError,
  type Assessment,
  correctnessReviewer,
  genericReviewer,
  licenseReviewer,
  secretsReviewer,
  securityReviewer,
} from "../mod.ts";

const DIFF = "diff --git a/src/app.ts b/src/app.ts\n" +
  "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n+const x = eval(input);\n";

/** A recorded fetch call with its URL and request body. */
interface Call {
  url: string;
  init?: RequestInit;
  body: string;
}

/** A fake `fetch` returning `status`/`responseBody`, recording each call. */
function recordFetch(
  responseBody: string,
  status = 200,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url: String(input), init, body });
    return Promise.resolve(new Response(responseBody, { status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/** Wrap an assessment in a Claude Messages-API response. */
function claude(assessment: Partial<Assessment>): string {
  return claudeText(JSON.stringify(assessment));
}
/** A raw-text Claude response (for testing JSON isolation). */
function claudeText(text: string): string {
  return JSON.stringify({
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
  });
}
function openai(assessment: Partial<Assessment>): string {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify(assessment) } }],
  });
}
function gemini(assessment: Partial<Assessment>): string {
  return JSON.stringify({
    candidates: [{
      content: { parts: [{ text: JSON.stringify(assessment) }] },
    }],
  });
}

/** A Claude response carrying token usage. */
function claudeWithUsage(
  assessment: Partial<Assessment>,
  usage: Record<string, number>,
): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(assessment) }],
    stop_reason: "end_turn",
    usage,
  });
}

/**
 * A fake `fetch` that routes by host: GitHub URLs get the comment API (the GET
 * lists `comments`, writes return `{}`, all at `githubStatus`); everything else
 * gets `provider`. Records each call.
 */
function routedFetch(opts: {
  provider: string;
  comments?: unknown[];
  githubStatus?: number;
}): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      init,
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (url.includes("api.github.com")) {
      const status = opts.githubStatus ?? 200;
      const payload = (init?.method ?? "GET") === "GET"
        ? JSON.stringify(opts.comments ?? [])
        : "{}";
      return Promise.resolve(new Response(payload, { status }));
    }
    return Promise.resolve(new Response(opts.provider, { status: 200 }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/** Run `fn` with the given env vars set, restoring the prior values after. */
async function withEnv(
  vars: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const prior = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    prior.set(key, Deno.env.get(key));
    Deno.env.set(key, value);
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

/**
 * Capture `console.log`/`console.warn` output produced by `fn`, with the
 * Actions job-summary file unset so non-quiet reviews don't write a real one.
 */
async function captured(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const { log, warn } = console;
  const summary = Deno.env.get("GITHUB_STEP_SUMMARY");
  Deno.env.delete("GITHUB_STEP_SUMMARY");
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  console.warn = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.log = log;
    console.warn = warn;
    if (summary !== undefined) Deno.env.set("GITHUB_STEP_SUMMARY", summary);
  }
  return lines;
}

Deno.test("security review passes below the threshold and calls Claude", async () => {
  const { fetch, calls } = recordFetch(
    claude({ score: 2, severity: "low", summary: "fine", findings: [] }),
  );
  await securityReviewer((r) =>
    r.provider("claude").apiKey("sk-test").quiet()
      .diff((d) => d.text(DIFF)).fetch(fetch)
  ).validate({ target: "deploy" });

  assertEquals(calls[0].url, "https://api.anthropic.com/v1/messages");
  assertEquals(calls[0].init?.method, "POST");
  const headers = calls[0].init?.headers as Record<string, string>;
  assertEquals(headers["x-api-key"], "sk-test");
  const body = JSON.parse(calls[0].body);
  assertEquals(body.model, "claude-opus-4-8"); // default model
  assertEquals(typeof body.system, "string");
  assertEquals(body.messages[0].content.includes("eval(input)"), true);
  // The response schema is enforced server-side, not just in the prompt.
  assertEquals(body.output_config.format.type, "json_schema");
  assertEquals(body.output_config.format.schema.type, "object");
});

Deno.test("the build breaks when the risk score exceeds the threshold", async () => {
  const { fetch } = recordFetch(
    claude({ score: 9, severity: "high", summary: "RCE risk", findings: [] }),
  );
  const error = await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
          .fetch(fetch)
      ).validate({ target: "deploy" }),
    AiReviewError,
    "risk score 9 exceeds 7",
  );
  assertEquals(error.message.includes('"deploy"'), true);
  assertEquals(error.message.includes("RCE risk"), true);
});

Deno.test("a high score clamps to 10 and still trips the default gate", async () => {
  const { fetch } = recordFetch(claude({ score: 50, findings: [] }));
  await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
          .fetch(fetch)
      ).validate({ target: "t" }),
    AiReviewError,
    "risk score 10 exceeds 7",
  );
});

Deno.test("severityAtLeast gates on a severity derived from findings", async () => {
  // No top-level severity → derived from the findings' max severity.
  const { fetch } = recordFetch(
    claude({ score: 3, findings: [{ title: "secret", severity: "high" }] }),
  );
  await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
          .failWhen((g) => g.severityAtLeast("high")).fetch(fetch)
      ).validate({ target: "t" }),
    AiReviewError,
    'severity "high" is at least "high"',
  );
});

Deno.test("a provider is required", async () => {
  await assertRejects(
    () => securityReviewer((r) => r.apiKey("k")).validate({ target: "t" }),
    AiReviewError,
    "a provider is required",
  );
});

Deno.test("an API key is required", async () => {
  await assertRejects(
    () =>
      securityReviewer((r) => r.provider("claude")).validate({ target: "t" }),
    AiReviewError,
    "an API key is required",
  );
});

Deno.test("skipIfKeyMissing skips the review and announces it, without calling the API", async () => {
  const { fetch, calls } = recordFetch(claude({ score: 9, findings: [] }));
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("").skipIfKeyMissing()
        .diff((d) => d.text(DIFF)).fetch(fetch)
    ).validate({ target: "deploy" })
  );
  assertEquals(calls.length, 0); // no provider call when skipped
  assertEquals(lines, ["[security review] skipped — no API key"]);
});

Deno.test("skipIfKeyMissing stays silent under quiet()", async () => {
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("").skipIfKeyMissing().quiet()
    )
      .validate({ target: "deploy" })
  );
  assertEquals(lines, []);
});

Deno.test("a skipped review is noted in the GitHub Actions job summary", async () => {
  const summaryFile = await Deno.makeTempFile();
  const prev = Deno.env.get("GITHUB_STEP_SUMMARY");
  Deno.env.set("GITHUB_STEP_SUMMARY", summaryFile);
  const { log } = console;
  console.log = () => {};
  try {
    await securityReviewer((r) =>
      r.provider("claude").apiKey("").skipIfKeyMissing()
    ).validate({ target: "deploy" });
    const md = await Deno.readTextFile(summaryFile);
    assertEquals(
      md.includes("## ⏭️ security review — `deploy`"),
      true,
    );
    assertEquals(md.includes("_Skipped — no API key._"), true);
  } finally {
    console.log = log;
    if (prev === undefined) Deno.env.delete("GITHUB_STEP_SUMMARY");
    else Deno.env.set("GITHUB_STEP_SUMMARY", prev);
    await Deno.remove(summaryFile);
  }
});

Deno.test("genericReviewer runs without explicit criteria using its built-in rubric", async () => {
  const { fetch, calls } = recordFetch(claude({ score: 0, findings: [] }));
  await genericReviewer((r) =>
    r.provider("claude").apiKey("k").quiet()
      .diff((d) => d.text(DIFF)).fetch(fetch)
  ).validate({ target: "t" });
  const body = JSON.parse(calls[0].body);
  // The default subject is in the system prompt.
  assertEquals(
    body.system.includes("code quality and maintainability"),
    true,
  );
  // With no criteria, the user prompt carries the diff alone — no project notes.
  assertEquals(
    body.messages[0].content.includes("Additional project notes"),
    false,
  );
});

Deno.test(".criteria(...) appends project notes above the diff in the user prompt", async () => {
  // It works for any reviewer, not just generic — here, the security one.
  const { fetch, calls } = recordFetch(claude({ score: 0, findings: [] }));
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet()
      .criteria("Strict TypeScript: no `any`, no `as`.")
      .diff((d) => d.text(DIFF)).fetch(fetch)
  ).validate({ target: "t" });
  const user = JSON.parse(calls[0].body).messages[0].content;
  assertEquals(user.includes("Additional project notes:"), true);
  assertEquals(user.includes("Strict TypeScript: no `any`, no `as`."), true);
  // The criteria sits *above* the diff section.
  assertEquals(
    user.indexOf("Additional project notes:") <
      user.indexOf("Unified diff to review:"),
    true,
  );
});

Deno.test("openai provider posts to chat/completions with a bearer token", async () => {
  const { fetch, calls } = recordFetch(openai({ score: 1, findings: [] }));
  await correctnessReviewer((r) =>
    r.provider("openai").apiKey("sk-oa").model("gpt-x").quiet()
      .diff((d) => d.text(DIFF)).fetch(fetch)
  ).validate({ target: "t" });
  assertEquals(calls[0].url, "https://api.openai.com/v1/chat/completions");
  const headers = calls[0].init?.headers as Record<string, string>;
  assertEquals(headers.authorization, "Bearer sk-oa");
  const body = JSON.parse(calls[0].body);
  assertEquals(body.model, "gpt-x");
  assertEquals(body.response_format.type, "json_schema");
  assertEquals(body.response_format.json_schema.strict, true);
  assertEquals(body.response_format.json_schema.schema.type, "object");
});

Deno.test("gemini provider posts to generateContent with the key in the URL", async () => {
  const { fetch, calls } = recordFetch(gemini({ score: 1, findings: [] }));
  await licenseReviewer((r) =>
    r.provider("gemini").apiKey("g-key").quiet()
      .diff((d) => d.text(DIFF)).fetch(fetch)
  ).validate({ target: "t" });
  assertEquals(
    calls[0].url.startsWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=g-key",
    ),
    true,
  );
  const body = JSON.parse(calls[0].body);
  assertEquals(body.systemInstruction.parts[0].text.length > 0, true);
  assertEquals(body.generationConfig.responseMimeType, "application/json");
  assertEquals(body.generationConfig.responseSchema.type, "object");
});

Deno.test("a non-2xx response fails closed, but onError warn passes", async () => {
  const { fetch } = recordFetch("nope", 401);
  await assertRejects(
    () =>
      secretsReviewer((r) =>
        r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
          .fetch(fetch)
      ).validate({ target: "t" }),
    AiReviewError,
    "claude API error: HTTP 401",
  );

  const warn = recordFetch("nope", 401);
  const lines = await captured(() =>
    secretsReviewer((r) =>
      r.provider("claude").apiKey("k").onError("warn").diff((d) => d.text(DIFF))
        .fetch(warn.fetch)
    ).validate({ target: "t" })
  );
  assertEquals(lines.some((l) => l.includes("skipped")), true);
});

Deno.test("a model refusal is surfaced as an error", async () => {
  const refusal = JSON.stringify({ content: [], stop_reason: "refusal" });
  const { fetch } = recordFetch(refusal);
  await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
          .fetch(fetch)
      ).validate({ target: "t" }),
    AiReviewError,
    "refused",
  );
});

Deno.test("invalid JSON fails, fenced/prose JSON parses", async () => {
  const bad = recordFetch(claudeText("not json at all"));
  await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
          .fetch(bad.fetch)
      ).validate({ target: "t" }),
    AiReviewError,
    "did not return valid JSON",
  );

  const fenced = recordFetch(
    claudeText('```json\n{"score": 0, "findings": []}\n```'),
  );
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
      .fetch(fenced.fetch)
  ).validate({ target: "t" }); // resolves
});

Deno.test("a malformed response shape fails closed", async () => {
  const { fetch } = recordFetch(JSON.stringify({ content: "oops" }));
  await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
          .fetch(fetch)
      ).validate({ target: "t" }),
    AiReviewError,
    "could not read",
  );
});

Deno.test("an empty diff passes without calling the model", async () => {
  const { fetch, calls } = recordFetch(claude({ score: 9, findings: [] }));
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet().diff((d) => d.text("   "))
      .fetch(fetch)
  ).validate({ target: "t" });
  assertEquals(calls.length, 0);
});

Deno.test("default excludes drop lockfile-only diffs", async () => {
  const lockDiff = 'diff --git a/deno.lock b/deno.lock\n+"x"\n';
  const { fetch, calls } = recordFetch(claude({ score: 9, findings: [] }));
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet().diff((d) => d.text(lockDiff))
      .fetch(fetch)
  ).validate({ target: "t" });
  assertEquals(calls.length, 0); // nothing left to review
});

Deno.test("include/exclude filter the diff by path", async () => {
  const two = "diff --git a/src/app.ts b/src/app.ts\n+code\n" +
    "diff --git a/generated/out.ts b/generated/out.ts\n+gen\n";
  const inc = recordFetch(claude({ score: 1, findings: [] }));
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet().diff((d) => d.text(two))
      .include("src/**").fetch(inc.fetch)
  ).validate({ target: "t" });
  const body = JSON.parse(inc.calls[0].body).messages[0].content;
  assertEquals(body.includes("src/app.ts"), true);
  assertEquals(body.includes("generated/out.ts"), false);

  const exc = recordFetch(claude({ score: 1, findings: [] }));
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet().diff((d) => d.text(two))
      .exclude("generated/**").fetch(exc.fetch)
  ).validate({ target: "t" });
  const body2 = JSON.parse(exc.calls[0].body).messages[0].content;
  assertEquals(body2.includes("generated/out.ts"), false);
});

Deno.test("maxDiffTokens truncates a large diff (and leaves a small one)", async () => {
  const big = "diff --git a/x b/x\n" + "+x".repeat(500);
  const cut = recordFetch(claude({ score: 0, findings: [] }));
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet().diff((d) => d.text(big))
      .maxDiffTokens(1).fetch(cut.fetch)
  ).validate({ target: "t" });
  assertEquals(
    JSON.parse(cut.calls[0].body).messages[0].content.includes("truncated"),
    true,
  );

  const keep = recordFetch(claude({ score: 0, findings: [] }));
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
      .maxDiffTokens(10000).fetch(keep.fetch)
  ).validate({ target: "t" }); // resolves, no truncation
});

Deno.test("base/staged diff is produced via the git exec seam, with effort", async () => {
  const seen: string[][] = [];
  const run = (argv: string[]) => {
    seen.push(argv);
    return Promise.resolve(DIFF);
  };
  const { fetch, calls } = recordFetch(claude({ score: 0, findings: [] }));
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet().effort("high")
      .diff((d) => d.base("origin/main")).exec(run).fetch(fetch)
  ).validate({ target: "t" });
  assertEquals(seen[0], ["git", "diff", "origin/main"]);
  assertEquals(JSON.parse(calls[0].body).output_config.effort, "high");

  const staged = recordFetch(claude({ score: 0, findings: [] }));
  const stagedRun = (argv: string[]) => {
    seen.push(argv);
    return Promise.resolve(DIFF);
  };
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet()
      .diff((d) => d.staged()).exec(stagedRun).fetch(staged.fetch)
  ).validate({ target: "t" });
  assertEquals(seen[1], ["git", "diff", "--cached"]);
});

Deno.test("the default diff source runs git via the shell (no network)", async () => {
  // No .exec()/.text(): exercises the real `git diff --cached` path. Whatever
  // the tree's staged state, the fake fetch keeps it off the network.
  const { fetch, calls } = recordFetch(claude({ score: 0, findings: [] }));
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet().diff((d) => d.staged())
      .fetch(fetch)
  ).validate({ target: "t" });
  assertEquals(calls.every((c) => c.url.includes("api.anthropic.com")), true);
});

Deno.test("the findings table is printed when not quiet", async () => {
  const { fetch } = recordFetch(
    claude({
      score: 1,
      severity: "low",
      summary: "one issue",
      findings: [{
        title: "weak hash",
        severity: "low",
        file: "a.ts",
        line: 3,
      }],
    }),
  );
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
    ).validate({ target: "t" })
  );
  assertEquals(lines.some((l) => l.includes("score 1/10")), true);
  assertEquals(
    lines.some((l) => l.includes("weak hash") && l.includes("a.ts:3")),
    true,
  );
  assertEquals(lines.some((l) => l.includes("one issue")), true);
});

Deno.test("malformed score/severity/findings degrade to a clean pass", async () => {
  // Non-number score → 0; unknown severity → derived; non-array findings → [].
  const { fetch } = recordFetch(
    JSON.stringify({
      content: [{
        text: JSON.stringify({
          score: "oops",
          severity: "bogus",
          findings: "nope",
        }),
      }],
      stop_reason: "end_turn",
    }),
  );
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
    ).validate({ target: "t" })
  );
  assertEquals(lines.some((l) => l.includes("score 0/10 (none)")), true);
});

Deno.test("findings print with and without a file, and carry detail", async () => {
  const { fetch } = recordFetch(
    claude({
      score: 1,
      severity: "low",
      summary: "",
      findings: [
        { title: "no-location", severity: "low" },
        { title: "located", severity: "medium", file: "f.ts", detail: "why" },
      ],
    }),
  );
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
    ).validate({ target: "t" })
  );
  assertEquals(
    lines.some((l) => l.includes("no-location") && !l.includes("(")),
    true,
  );
  assertEquals(
    lines.some((l) => l.includes("located") && l.includes("(f.ts)")),
    true,
  );
});

Deno.test("a thrown Error and a thrown non-Error both surface as AiReviewError", async () => {
  const boom = (() => Promise.reject(new TypeError("boom"))) as typeof fetch;
  await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
          .fetch(boom)
      ).validate({ target: "t" }),
    AiReviewError,
    "boom",
  );

  const weird = (() => Promise.reject("weird")) as typeof fetch;
  await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
          .fetch(weird)
      ).validate({ target: "t" }),
    AiReviewError,
    "weird",
  );
});

Deno.test("failWhen scoreAbove gates on an explicit score threshold", async () => {
  const { fetch } = recordFetch(claude({ score: 6, findings: [] }));
  await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
          .failWhen((g) => g.scoreAbove(5)).fetch(fetch)
      ).validate({ target: "t" }),
    AiReviewError,
    "risk score 6 exceeds 5",
  );
});

Deno.test("a null inside the response shape fails closed", async () => {
  const { fetch } = recordFetch(
    JSON.stringify({ content: [null], stop_reason: "end_turn" }),
  );
  await assertRejects(
    () =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
          .fetch(fetch)
      ).validate({ target: "t" }),
    AiReviewError,
    "could not read",
  );
});

Deno.test("the assessment is appended to the GitHub Actions job summary", async () => {
  const summaryFile = await Deno.makeTempFile();
  const prev = Deno.env.get("GITHUB_STEP_SUMMARY");
  Deno.env.set("GITHUB_STEP_SUMMARY", summaryFile);
  const { log } = console;
  console.log = () => {};
  try {
    // With findings + a summary: renders the table, location, and pipe escape.
    const a = recordFetch(
      claude({
        score: 4,
        severity: "high",
        summary: "two issues found",
        findings: [
          {
            title: "sql | injection",
            severity: "high",
            file: "db.ts",
            line: 9,
          },
          { title: "weak hash", severity: "low" },
        ],
      }),
    );
    await securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(a.fetch)
    ).validate({ target: "deploy" });

    // Clean run: no table, no quote.
    const b = recordFetch(claude({ score: 0, findings: [] }));
    await securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(b.fetch)
    ).validate({ target: "deploy" });

    const md = await Deno.readTextFile(summaryFile);
    assertEquals(md.includes("## 🔎 security review — `deploy`"), true);
    assertEquals(md.includes("**Score:** 4/10 · **Severity:** high"), true);
    assertEquals(md.includes("| high | sql \\| injection | db.ts:9 |"), true);
    assertEquals(md.includes("| low | weak hash | — |"), true);
    assertEquals(md.includes("> two issues found"), true);
    assertEquals(md.includes("**Score:** 0/10"), true);
  } finally {
    console.log = log;
    if (prev === undefined) Deno.env.delete("GITHUB_STEP_SUMMARY");
    else Deno.env.set("GITHUB_STEP_SUMMARY", prev);
    await Deno.remove(summaryFile);
  }
});

Deno.test("an unwritable job-summary file never fails the review", async () => {
  const dir = await Deno.makeTempDir(); // a directory is not a writable file
  const prev = Deno.env.get("GITHUB_STEP_SUMMARY");
  Deno.env.set("GITHUB_STEP_SUMMARY", dir);
  const { log } = console;
  console.log = () => {};
  try {
    const { fetch } = recordFetch(claude({ score: 0, findings: [] }));
    await securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
    ).validate({ target: "t" }); // resolves despite the unwritable summary
  } finally {
    console.log = log;
    if (prev === undefined) Deno.env.delete("GITHUB_STEP_SUMMARY");
    else Deno.env.set("GITHUB_STEP_SUMMARY", prev);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a transient 503 from the provider is retried, then the review passes", async () => {
  // A scripted fetch that returns 503 once, then the assessment.
  let i = 0;
  const responses: Response[] = [
    new Response("overloaded", { status: 503 }),
    new Response(claude({ score: 0, findings: [] }), { status: 200 }),
  ];
  const scripted =
    ((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(responses[i++])) as typeof fetch;
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF))
        .fetch(scripted)
        .retry({ baseDelayMs: 0 }) // skip the real backoff in tests
    ).validate({ target: "t" })
  );
  assertEquals(i, 2); // first call hit 503, second succeeded
  // The run announces itself and the retry, so it doesn't look like a hang.
  assertEquals(
    lines.some((l) =>
      l.startsWith('[security review] reviewing "t" — claude/claude-opus-4-8')
    ),
    true,
  );
  assertEquals(
    lines.some((l) =>
      l.includes("attempt 1/3 failed (HTTP 503) — retrying in")
    ),
    true,
  );
});

Deno.test("the start line echoes provider, model, gate, and comment settings", async () => {
  const { fetch } = recordFetch(claude({ score: 0, findings: [] }));
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").model("claude-x").diff((d) =>
        d.text(DIFF)
      )
        .failWhen((g) => g.scoreAbove(8)).fetch(fetch)
    ).validate({ target: "deploy" })
  );
  assertEquals(
    lines.some((l) =>
      l ===
        '[security review] reviewing "deploy" — claude/claude-x · gate score>8'
    ),
    true,
  );
});

Deno.test("retry({ attempts: 1 }) disables retries — a 503 surfaces immediately", async () => {
  const { fetch } = recordFetch("", 503);
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
        .retry({ attempts: 1 }).onError("warn")
    ).validate({ target: "t" })
  );
  assertEquals(
    lines.some((l) => l.includes("claude API error: HTTP 503")),
    true,
  );
});

Deno.test("token usage from the provider is shown in the output", async () => {
  const { fetch } = recordFetch(
    claudeWithUsage({ score: 1, findings: [] }, {
      input_tokens: 1000,
      output_tokens: 200,
    }),
  );
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
    ).validate({ target: "t" })
  );
  // Claude reports no total; it is derived from input + output.
  assertEquals(
    lines.includes("  tokens: 1000 in · 200 out · 1200 total"),
    true,
  );
});

Deno.test("partial usage renders only the reported counts", async () => {
  // Only an input count: no output, and no total to derive.
  const { fetch } = recordFetch(
    claudeWithUsage({ score: 0, findings: [] }, { input_tokens: 42 }),
  );
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
    ).validate({ target: "t" })
  );
  assertEquals(lines.includes("  tokens: 42 in"), true);
});

Deno.test("token usage is read from the openai and gemini response shapes", async () => {
  const oa = recordFetch(JSON.stringify({
    choices: [{
      message: { content: JSON.stringify({ score: 0, findings: [] }) },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }));
  let lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("openai").apiKey("k").diff((d) => d.text(DIFF)).fetch(oa.fetch)
    ).validate({ target: "t" })
  );
  assertEquals(lines.includes("  tokens: 10 in · 5 out · 15 total"), true);

  const gm = recordFetch(JSON.stringify({
    candidates: [{
      content: {
        parts: [{ text: JSON.stringify({ score: 0, findings: [] }) }],
      },
    }],
    usageMetadata: {
      promptTokenCount: 7,
      candidatesTokenCount: 3,
      totalTokenCount: 10,
    },
  }));
  lines = await captured(() =>
    licenseReviewer((r) =>
      r.provider("gemini").apiKey("k").diff((d) => d.text(DIFF)).fetch(gm.fetch)
    ).validate({ target: "t" })
  );
  assertEquals(lines.includes("  tokens: 7 in · 3 out · 10 total"), true);
});

Deno.test("token usage is included in the job-summary markdown", async () => {
  const summaryFile = await Deno.makeTempFile();
  const prev = Deno.env.get("GITHUB_STEP_SUMMARY");
  Deno.env.set("GITHUB_STEP_SUMMARY", summaryFile);
  const { log } = console;
  console.log = () => {};
  try {
    const { fetch } = recordFetch(
      claudeWithUsage({ score: 0, findings: [] }, {
        input_tokens: 100,
        output_tokens: 20,
      }),
    );
    await securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
    ).validate({ target: "deploy" });
    const md = await Deno.readTextFile(summaryFile);
    assertEquals(md.includes("**Tokens:** 100 in · 20 out · 120 total"), true);
  } finally {
    console.log = log;
    if (prev === undefined) Deno.env.delete("GITHUB_STEP_SUMMARY");
    else Deno.env.set("GITHUB_STEP_SUMMARY", prev);
    await Deno.remove(summaryFile);
  }
});

Deno.test("comment() posts the assessment to the pull request", async () => {
  await withEnv(
    { GITHUB_REPOSITORY: "zuke-build/zuke", GITHUB_REF: "refs/pull/42/merge" },
    async () => {
      const { fetch, calls } = routedFetch({
        provider: claude({ score: 1, findings: [] }),
        comments: [],
      });
      await captured(() =>
        securityReviewer((r) =>
          r.provider("claude").apiKey("k").comment().githubToken("tkn")
            .diff((d) => d.text(DIFF)).fetch(fetch)
        ).validate({ target: "deploy" })
      );
      const posts = calls.filter((c) =>
        c.url.includes("api.github.com") && c.init?.method === "POST"
      );
      assertEquals(posts.length, 1);
      assertEquals(
        posts[0].url,
        "https://api.github.com/repos/zuke-build/zuke/issues/42/comments",
      );
      assertEquals(
        JSON.parse(posts[0].body).body.includes("## 🔎 security review"),
        true,
      );
    },
  );
});

Deno.test("comment() uses GITHUB_TOKEN and updates the existing comment", async () => {
  await withEnv(
    {
      GITHUB_REPOSITORY: "zuke-build/zuke",
      GITHUB_REF: "refs/pull/42/merge",
      GITHUB_TOKEN: "env-token",
    },
    async () => {
      const { fetch, calls } = routedFetch({
        provider: claude({ score: 1, findings: [] }),
        comments: [
          { id: 5, body: "<!-- zuke-ai-review:security review -->\nold" },
        ],
      });
      await captured(() =>
        securityReviewer((r) =>
          r.provider("claude").apiKey("k").comment()
            .diff((d) => d.text(DIFF)).fetch(fetch)
        ).validate({ target: "deploy" })
      );
      const writes = calls.filter((c) => c.init?.method === "PATCH");
      assertEquals(writes.length, 1);
      assertEquals(
        writes[0].url,
        "https://api.github.com/repos/zuke-build/zuke/issues/comments/5",
      );
      const headers = writes[0].init?.headers as Record<string, string>;
      assertEquals(headers.authorization, "Bearer env-token");
    },
  );
});

Deno.test("comment() warns and skips when there is no PR context", async () => {
  await withEnv({ GITHUB_REF: "refs/heads/master" }, async () => {
    const { fetch, calls } = routedFetch({
      provider: claude({ score: 0, findings: [] }),
    });
    const lines = await captured(() =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").comment().githubToken("tkn")
          .diff((d) => d.text(DIFF)).fetch(fetch)
      ).validate({ target: "deploy" })
    );
    assertEquals(calls.some((c) => c.url.includes("api.github.com")), false);
    assertEquals(lines.some((l) => l.includes("no PR context")), true);
  });
});

Deno.test("a failed PR comment never breaks the review", async () => {
  await withEnv(
    { GITHUB_REPOSITORY: "zuke-build/zuke", GITHUB_REF: "refs/pull/42/merge" },
    async () => {
      const { fetch } = routedFetch({
        provider: claude({ score: 0, findings: [] }),
        githubStatus: 500,
      });
      const lines = await captured(() =>
        securityReviewer((r) =>
          r.provider("claude").apiKey("k").comment().githubToken("tkn")
            .diff((d) => d.text(DIFF)).fetch(fetch)
        ).validate({ target: "deploy" })
      ); // resolves despite the 500
      assertEquals(
        lines.some((l) => l.includes("could not post PR comment")),
        true,
      );
    },
  );
});
