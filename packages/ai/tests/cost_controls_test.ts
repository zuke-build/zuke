import { assertEquals } from "../../core/tests/_assert.ts";
import {
  aiCache,
  aiFixer,
  type Assessment,
  budget,
  type CacheEntry,
  type CacheStore,
  findingFingerprint,
  type Fix,
  securityReviewer,
  suppressions,
} from "../mod.ts";
import { consoleLines, toMarkdown } from "../src/report.ts";
import type { RemediationContext } from "@zuke/core";

const DIFF = "diff --git a/src/app.ts b/src/app.ts\n" +
  "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n+const x = eval(input);\n";

/** A recorded fetch call. */
interface Call {
  url: string;
  body: string;
}

/** A fake `fetch` returning a fixed body, recording each call. */
function recordFetch(body: string): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/** Wrap an assessment in a Claude Messages-API response, optionally with usage. */
function claude(
  assessment: Partial<Assessment>,
  usage?: Record<string, number>,
): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(assessment) }],
    stop_reason: "end_turn",
    ...(usage !== undefined ? { usage } : {}),
  });
}

/** Wrap a fix in a Claude Messages-API response, optionally with usage. */
function claudeFix(
  fix: Partial<Fix>,
  usage?: Record<string, number>,
): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(fix) }],
    stop_reason: "end_turn",
    ...(usage !== undefined ? { usage } : {}),
  });
}

/** An in-memory {@link CacheStore} plus its backing map, for assertions. */
function memStore(): CacheStore & { map: Map<string, CacheEntry> } {
  const map = new Map<string, CacheEntry>();
  return {
    map,
    get: (key) => Promise.resolve(map.get(key)),
    set: (key, entry) => {
      map.set(key, entry);
      return Promise.resolve();
    },
  };
}

/** Capture console output with the job-summary file unset (no real writes). */
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

const CTX: RemediationContext = {
  target: "test",
  attempt: 1,
  error: new Error("boom: a test failed"),
};

const ONE_EDIT: Partial<Fix> = {
  diagnosis: "off-by-one in loop",
  rootCause: "wrong bound",
  confidence: "high",
  edits: [{ path: "src/app.ts", content: "export const x = 1;\n" }],
};

/** Make a diagnose-only fixer hermetic (no fs, no git, no env). */
function hermetic(f: ReturnType<typeof aiFixer>): ReturnType<typeof aiFixer> {
  return f.conventions("").diff((d) => d.text("")).exec(() =>
    Promise.resolve("")
  ).write(() => Promise.resolve()).env(() => undefined).quiet();
}

// ----- Budget --------------------------------------------------------------

Deno.test("reviewer records token usage against a shared budget", async () => {
  const b = budget((x) => x.maxTokens(1000));
  const { fetch } = recordFetch(
    claude({ score: 0, severity: "none", summary: "", findings: [] }, {
      input_tokens: 100,
      output_tokens: 20,
    }),
  );
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
        .budget(b)
    ).validate({ target: "t" })
  );
  assertEquals(b.spend_().totalTokens, 120);
  assertEquals(b.spend_().calls, 1);
  assertEquals(lines.some((l) => l.startsWith("  budget:")), true);
});

Deno.test("reviewer skips the call once the budget is exhausted", async () => {
  const b = budget((x) => x.maxTokens(0)); // exhausted before any call
  // A critical finding that *would* trip the gate — but the call never happens.
  const { fetch, calls } = recordFetch(
    claude({
      score: 9,
      severity: "critical",
      summary: "bad",
      findings: [{ title: "rce", severity: "critical" }],
    }),
  );
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
        .budget(b)
    ).validate({ target: "t" })
  );
  assertEquals(calls.length, 0);
  assertEquals(lines.some((l) => l.includes("AI budget exhausted")), true);
});

// ----- Cache ---------------------------------------------------------------

Deno.test("reviewer caches a response and reuses it on a repeat run", async () => {
  const store = memStore();
  const c = aiCache((x) => x.store(store));
  const { fetch, calls } = recordFetch(
    claude({ score: 1, severity: "low", summary: "s", findings: [] }),
  );
  const run = () =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
        .fetch(fetch).cache(c)
    ).validate({ target: "t" });
  await run();
  await run();
  assertEquals(calls.length, 1); // second served from cache
  assertEquals(store.map.size, 1);
});

Deno.test("a cached review notes it served from cache", async () => {
  const store = memStore();
  const c = aiCache((x) => x.store(store));
  const { fetch } = recordFetch(
    claude({ score: 0, severity: "none", summary: "", findings: [] }),
  );
  const run = () =>
    captured(() =>
      securityReviewer((r) =>
        r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
          .cache(c)
      ).validate({ target: "t" })
    );
  await run();
  const lines = await run();
  assertEquals(lines.includes("  (cached — no API call)"), true);
});

// ----- Suppression ---------------------------------------------------------

Deno.test("a finding whose id is suppressed is dropped from the review", async () => {
  const dismissed = { title: "weak hash", severity: "low" as const };
  const sup = suppressions((s) =>
    s.add(findingFingerprint("security", dismissed))
  );
  const { fetch } = recordFetch(
    claude({
      score: 1,
      severity: "low",
      summary: "s",
      findings: [dismissed, { title: "real one", severity: "low" }],
    }),
  );
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
        .suppress(sup)
    ).validate({ target: "t" })
  );
  assertEquals(lines.some((l) => l.includes("suppressed 1 finding(s)")), true);
  assertEquals(lines.some((l) => l.includes("— 1 finding(s)")), true);
  // The hidden finding is still listed (auditable), not silently erased.
  assertEquals(
    lines.some((l) => l.includes("suppressed: [low] weak hash")),
    true,
  );
});

Deno.test("suppressing every finding clears the score and passes the gate", async () => {
  const only = { title: "rce", severity: "critical" as const, file: "x.ts" };
  const sup = suppressions((s) => s.add(findingFingerprint("security", only)));
  // Score 9 would trip the default gate (>7); suppression must clear it.
  const { fetch } = recordFetch(
    claude({ score: 9, severity: "critical", summary: "s", findings: [only] }),
  );
  await securityReviewer((r) =>
    r.provider("claude").apiKey("k").quiet().diff((d) => d.text(DIFF))
      .fetch(fetch).suppress(sup)
  ).validate({ target: "t" }); // resolves — does not throw
});

Deno.test("partial suppression recomputes severity from what remains", async () => {
  const high = { title: "high one", severity: "high" as const };
  const low = { title: "low one", severity: "low" as const };
  const sup = suppressions((s) => s.add(findingFingerprint("security", high)));
  const { fetch } = recordFetch(
    claude({ score: 5, severity: "high", summary: "s", findings: [high, low] }),
  );
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
        .suppress(sup)
    ).validate({ target: "t" })
  );
  // Header severity drops from high to low after the high finding is dropped.
  assertEquals(lines.some((l) => l.includes("(low) — 1 finding(s)")), true);
});

Deno.test("an empty suppress list leaves the findings untouched", async () => {
  // An injected reader that finds no file -> no fingerprints, nothing dropped.
  const sup = suppressions((s) => s.reader(() => Promise.resolve(undefined)));
  const { fetch } = recordFetch(
    claude({
      score: 1,
      severity: "low",
      summary: "s",
      findings: [{ title: "a", severity: "low" }],
    }),
  );
  const lines = await captured(() =>
    securityReviewer((r) =>
      r.provider("claude").apiKey("k").diff((d) => d.text(DIFF)).fetch(fetch)
        .suppress(sup)
    ).validate({ target: "t" })
  );
  assertEquals(lines.some((l) => l.includes("suppressed")), false);
});

// ----- Report rendering ----------------------------------------------------

Deno.test("consoleLines renders cache, suppressed, and budget extras", () => {
  const lines = consoleLines(
    "r",
    { score: 0, severity: "none", summary: "", findings: [] },
    undefined,
    { fromCache: true, suppressed: 2, budget: "spent 5 tokens" },
  );
  assertEquals(lines.includes("  (cached — no API call)"), true);
  assertEquals(
    lines.includes("  suppressed 2 finding(s) via the suppress list"),
    true,
  );
  assertEquals(lines.includes("  budget: spent 5 tokens"), true);
});

Deno.test("toMarkdown renders budget, suppressed, cache, and id-hint", () => {
  const md = toMarkdown(
    "r",
    "t",
    {
      score: 1,
      severity: "low",
      summary: "",
      findings: [{ title: "weak hash", severity: "low", id: "abc1" }],
    },
    undefined,
    { budget: "B", suppressed: 3, fromCache: true },
  );
  assertEquals(md.includes("**Budget:** B"), true);
  assertEquals(md.includes("**Suppressed:** 3 finding(s)"), true);
  assertEquals(md.includes("_Served from cache — no API call._"), true);
  assertEquals(md.includes("Dismiss a false positive"), true);
  assertEquals(md.includes("- `abc1` — weak hash"), true);
});

Deno.test("toMarkdown omits the dismiss hint when no finding has an id", () => {
  const md = toMarkdown("r", "t", {
    score: 1,
    severity: "low",
    summary: "",
    findings: [{ title: "x", severity: "low" }],
  });
  assertEquals(md.includes("Dismiss a false positive"), false);
});

Deno.test("toMarkdown lists suppressed findings in an auditable section", () => {
  const md = toMarkdown(
    "security review",
    "t",
    { score: 0, severity: "none", summary: "", findings: [] },
    undefined,
    {
      suppressed: 1,
      suppressedFindings: [
        {
          title: "sql | injection",
          severity: "high",
          file: "db.ts",
          line: 9,
          id: "abc1",
        },
      ],
    },
  );
  assertEquals(md.includes("**Suppressed (not gating):**"), true);
  // The hidden finding is shown with its ID and the pipe escaped in the cell.
  assertEquals(
    md.includes("| high | sql \\| injection | db.ts:9 | abc1 |"),
    true,
  );
});

Deno.test("consoleLines lists each suppressed finding under the count", () => {
  const lines = consoleLines(
    "r",
    { score: 0, severity: "none", summary: "", findings: [] },
    undefined,
    {
      suppressed: 1,
      suppressedFindings: [
        {
          title: "weak hash",
          severity: "high",
          file: "db.ts",
          line: 9,
          id: "abc1",
        },
      ],
    },
  );
  assertEquals(
    lines.includes("    suppressed: [high] weak hash (db.ts:9) · abc1"),
    true,
  );
});

// ----- Fixer ---------------------------------------------------------------

Deno.test("fixer skips the model call when the budget is exhausted", async () => {
  const b = budget((x) => x.maxTokens(0));
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const result = await hermetic(
    aiFixer((f) => f.provider("claude").apiKey("k").budget(b)),
  ).fetch(fetch).remediate(CTX);
  assertEquals(result.retry, false);
  assertEquals(calls.length, 0);
});

Deno.test("fixer records usage against a budget", async () => {
  const b = budget((x) => x.maxTokens(1000));
  const { fetch } = recordFetch(
    claudeFix(ONE_EDIT, { input_tokens: 10, output_tokens: 5 }),
  );
  await hermetic(aiFixer((f) => f.provider("claude").apiKey("k").budget(b)))
    .fetch(fetch).remediate(CTX);
  assertEquals(b.spend_().totalTokens, 15);
});

Deno.test("fixer reuses a cached fix on a repeat failure", async () => {
  const store = memStore();
  const c = aiCache((x) => x.store(store));
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const run = () =>
    hermetic(aiFixer((f) => f.provider("claude").apiKey("k").cache(c)))
      .fetch(fetch).remediate(CTX);
  await run();
  await run();
  assertEquals(calls.length, 1);
  assertEquals(store.map.size, 1);
});
