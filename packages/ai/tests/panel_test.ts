// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The review panel: the reviewers attached side by side to one target post one
 * comment between them. Driven through `validate(...)` with the `peers` core
 * hands each validation, against a fake GitHub that keeps the pull request's
 * comments, so a second run reads what the first one posted.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import type { Validation, ValidationContext } from "@zuke/core";
import {
  AiReviewError,
  type AssessmentFinding,
  findingFingerprint,
  genericReviewer,
  type Reviewer,
  securityReviewer,
} from "../mod.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { silence } from "../../core/tests/_console.ts";
import { reacted, REACTIONS } from "./_reactions.ts";
import { decodeState, encodeState } from "../src/state.ts";
import { Panel, renderPanel, seatOf } from "../src/panel.ts";

const GITHUB_API = "https://api.github.com";
const COMMENTS = `${GITHUB_API}/repos/zuke-build/zuke/issues/7/comments`;
const DIFF = "diff --git a/src/app.ts b/src/app.ts\n" +
  "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n+const x = eval(input);\n";

/** A comment as GitHub lists it. */
interface Listed {
  id: number;
  body: string;
  user: { login: string; type: string };
  author_association: string;
}

/**
 * A fake GitHub keeping the pull request's comments — a POST adds one, a PATCH
 * edits one — and a provider answering each reviewer from `answers`, by the
 * reviewer kind its prompt names.
 */
function fakeGithub(answers: Record<string, string>, seed: Listed[] = []) {
  const comments: Listed[] = [...seed];
  const writes: Array<{ method: string; url: string }> = [];
  const prompts: string[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (REACTIONS.test(url)) return reacted();
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    if (url.startsWith(`${GITHUB_API}/`)) {
      if (url.endsWith("/user")) {
        return Promise.resolve(new Response("{}", { status: 403 }));
      }
      if (method === "GET") {
        const listing = url.startsWith(COMMENTS) ? comments : [];
        return Promise.resolve(new Response(JSON.stringify(listing)));
      }
      writes.push({ method, url });
      const text = String(JSON.parse(body).body ?? "");
      if (method === "POST" && url === COMMENTS) {
        comments.push({
          id: 100 + comments.length,
          body: text,
          user: { login: "github-actions[bot]", type: "Bot" },
          author_association: "NONE",
        });
      } else if (method === "PATCH") {
        const id = Number(url.split("/").at(-1));
        const comment = comments.find((c) => c.id === id);
        if (comment !== undefined) comment.body = text;
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 1 })));
    }
    prompts.push(body);
    const kind = Object.keys(answers).find((k) => body.includes(k)) ?? "";
    return Promise.resolve(new Response(answers[kind] ?? "", { status: 200 }));
  }) as typeof fetch;
  return { fetch: impl, comments, writes, prompts };
}

/** A Claude Messages-API response carrying `assessment`. */
function claude(assessment: unknown): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(assessment) }],
    stop_reason: "end_turn",
  });
}

const CLEAN = claude({ score: 0, severity: "none", findings: [] });
const EVAL: AssessmentFinding = {
  title: "Eval of user input",
  severity: "high",
  file: "src/app.ts",
  line: 4,
};
const FAILING = claude({ score: 9, severity: "high", findings: [EVAL] });
const MINOR = claude({
  score: 3,
  severity: "low",
  findings: [{ title: "Name is vague", severity: "low", file: "src/app.ts" }],
});

/** The prompt text that tells the two reviewers' calls apart. */
const SECURITY = "security";
const QUALITY = "maintainability";

/** Run `validations` the way the scheduler does: in order, as peers. */
async function runAll(
  validations: Validation[],
  run = crypto.randomUUID(),
  target = "review",
): Promise<unknown> {
  const context: ValidationContext = {
    target,
    redact: (text) => text,
    runId: run,
    peers: validations,
  };
  try {
    await withEnv({
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "zuke-build/zuke",
      GITHUB_REF: "refs/pull/7/merge",
      GITHUB_TOKEN: "tkn",
      GITHUB_STEP_SUMMARY: undefined,
    }, () =>
      silence(async () => {
        for (const validation of validations) {
          await validation.validate(context);
        }
      }));
  } catch (error) {
    return error;
  }
  return undefined;
}

/** A commenting reviewer of each kind, on `fetch`. */
function pair(
  impl: typeof fetch,
  configure: (r: Reviewer) => Reviewer = (r) => r,
): [Reviewer, Reviewer] {
  const base = (r: Reviewer) =>
    configure(
      r.provider("claude").apiKey("k").comment().diff((d) => d.text(DIFF))
        .fetch(impl),
    );
  return [securityReviewer(base), genericReviewer(base)];
}

Deno.test("the reviewers of one target post one comment between them", async () => {
  const github = fakeGithub({ [SECURITY]: MINOR, [QUALITY]: CLEAN });
  const threw = await runAll(pair(github.fetch));
  assertEquals(threw, undefined);
  assertEquals(github.writes.filter((w) => w.url === COMMENTS).length, 1);
  assertEquals(github.comments.length, 1);
  const body = github.comments[0].body;
  assertEquals(
    body.startsWith(
      "<!-- zuke-ai-review:panel:security review + generic review -->\n",
    ),
    true,
  );
  assertStringIncludes(body, "🤏 **Passed with findings**");
  assertStringIncludes(
    body,
    "| 🛡️ | security review | 🤏 passed with findings | 3/10 | low | 1 |",
  );
  assertStringIncludes(
    body,
    "| 🧹 | generic review | ✅ passed | 0/10 | none | 0 |",
  );
  // The merged table names the reviewer that raised each finding.
  assertStringIncludes(body, "| 🛡️ security review | low | Name is vague |");
  // Each reviewer's report, folded.
  assertStringIncludes(
    body,
    "<summary>🛡️ <b>security review</b> — 🤏 passed with findings · 3/10" +
      "</summary>",
  );
  assertStringIncludes(
    body,
    "<summary>🧹 <b>generic review</b> — ✅ passed · 0/10</summary>",
  );
});

Deno.test("every reviewer runs when an earlier one fails; the last raises every failure", async () => {
  const github = fakeGithub({ [SECURITY]: FAILING, [QUALITY]: FAILING });
  const [security, quality] = pair(github.fetch);
  const threw = await runAll([security, quality]);
  assertEquals(threw instanceof AiReviewError, true);
  const message = threw instanceof Error ? threw.message : "";
  assertStringIncludes(message, 'security review of "review" failed');
  assertStringIncludes(message, 'generic review of "review" failed');
  // Both reviewed, and the one comment carries both verdicts.
  assertEquals(github.comments.length, 1);
  const body = github.comments[0].body;
  assertStringIncludes(body, "❌ **Failed**");
  assertStringIncludes(body, "| 🛡️ | security review | ❌ failed | 9/10 |");
  assertStringIncludes(body, "| 🧹 | generic review | ❌ failed | 9/10 |");

  // One failing member: its own error comes through as it was raised.
  const one = fakeGithub({ [SECURITY]: FAILING, [QUALITY]: CLEAN });
  const single = await runAll(pair(one.fetch));
  assertEquals(single instanceof AiReviewError, true);
  assertEquals(
    single instanceof Error ? single.message.includes("generic") : true,
    false,
  );
});

Deno.test("findings are merged most severe first, each with its reviewer and id", async () => {
  const github = fakeGithub({ [SECURITY]: MINOR, [QUALITY]: FAILING });
  await runAll(pair(github.fetch));
  const body = github.comments[0].body;
  const high = body.indexOf("| 🧹 generic review | high | Eval of user input");
  const low = body.indexOf("| 🛡️ security review | low | Name is vague");
  assertEquals(high > -1 && low > high, true);
  const id = findingFingerprint("generic", EVAL);
  assertStringIncludes(body, `| src/app.ts:4 | \`${id}\` |`);
});

Deno.test("a re-run updates the panel's comment; any appending member appends", async () => {
  const github = fakeGithub({ [SECURITY]: CLEAN, [QUALITY]: CLEAN });
  await runAll(pair(github.fetch));
  await runAll(pair(github.fetch));
  assertEquals(github.comments.length, 1);
  assertEquals(github.writes.map((w) => w.method), ["POST", "PATCH"]);
  const [security] = pair(github.fetch);
  const [, appending] = pair(github.fetch, (r) => r.comment("append"));
  await runAll([security, appending]);
  assertEquals(github.comments.length, 2);
});

Deno.test("a skipped or broken member keeps its row", async () => {
  const github = fakeGithub({ [SECURITY]: CLEAN, [QUALITY]: CLEAN });
  const [security] = pair(github.fetch);
  const keyless = genericReviewer((r) =>
    r.provider("claude").apiKey("").skipIfKeyMissing().comment()
      .diff((d) => d.text(DIFF)).fetch(github.fetch)
  );
  assertEquals(await runAll([security, keyless]), undefined);
  assertStringIncludes(
    github.comments[0].body,
    "| 🧹 | generic review | ⏭️ skipped — no API key | — | — | — |",
  );

  // A provider failure under onError("warn") is a skip that says why.
  const down = fakeGithub({ [SECURITY]: CLEAN });
  const [ok] = pair(down.fetch);
  const warned = genericReviewer((r) =>
    r.provider("claude").apiKey("k").onError("warn").comment()
      .diff((d) => d.text(DIFF)).fetch(down.fetch)
  );
  assertEquals(await runAll([ok, warned]), undefined);
  assertStringIncludes(
    down.comments[0].body,
    "| 🧹 | generic review | ⏭️ skipped — the review failed:",
  );

  // A member that errors before reporting shows it did not finish, and fails.
  const broken = fakeGithub({ [SECURITY]: CLEAN });
  const [fine] = pair(broken.fetch);
  const noProvider = genericReviewer((r) =>
    r.apiKey("k").comment().fetch(broken.fetch)
  );
  const threw = await runAll([fine, noProvider]);
  assertEquals(threw instanceof AiReviewError, true);
  assertStringIncludes(broken.comments[0].body, "❌ **Failed**");
  assertStringIncludes(
    broken.comments[0].body,
    "| ⚠️ | generic review | ⚠️ did not finish | — | — | — |",
  );
});

Deno.test("only reviewers side by side that post form a panel", async () => {
  // Another validation between them splits the two: each posts alone.
  const github = fakeGithub({ [SECURITY]: CLEAN, [QUALITY]: CLEAN });
  const [security, quality] = pair(github.fetch);
  const between: Validation = { validate: () => {} };
  await runAll([security, between, quality]);
  assertEquals(
    github.comments.map((c) => c.body.split("\n")[0]),
    [
      "<!-- zuke-ai-review:security review -->",
      "<!-- zuke-ai-review:generic review -->",
    ],
  );

  // A quiet reviewer posts nothing, so it does not join one.
  const quiet = fakeGithub({ [SECURITY]: CLEAN, [QUALITY]: CLEAN });
  const [loud] = pair(quiet.fetch);
  const [, hushed] = pair(quiet.fetch, (r) => r.quiet());
  await runAll([loud, hushed]);
  assertEquals(
    quiet.comments.map((c) => c.body.split("\n")[0]),
    ["<!-- zuke-ai-review:security review -->"],
  );

  // Without peers — an older core, or validate driven directly — alone.
  const alone = fakeGithub({ [SECURITY]: CLEAN });
  const [solo] = pair(alone.fetch);
  await withEnv(
    {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "zuke-build/zuke",
      GITHUB_REF: "refs/pull/7/merge",
      GITHUB_TOKEN: "tkn",
      GITHUB_STEP_SUMMARY: undefined,
    },
    () => silence(() => solo.validate({ target: "review", redact: (t) => t })),
  );
  assertEquals(
    alone.comments[0].body.split("\n")[0],
    "<!-- zuke-ai-review:security review -->",
  );
});

Deno.test("each member's state rides in the comment under its name, and is read back", async () => {
  const github = fakeGithub({ [SECURITY]: FAILING, [QUALITY]: MINOR });
  const discussing = (r: Reviewer) => r.discussion();
  await runAll(pair(github.fetch, discussing));
  const body = github.comments[0].body;
  const security = decodeState(body, "security review");
  const quality = decodeState(body, "generic review");
  assertEquals(security?.findings.map((f) => f.title), [EVAL.title]);
  assertEquals(quality?.findings.map((f) => f.title), ["Name is vague"]);
  // No untagged block: nothing older code would take for its own.
  assertEquals(decodeState(body), undefined);
  // The state blocks come after every report.
  assertEquals(
    body.lastIndexOf("</details>") < body.indexOf("<!-- zuke-ai-state@"),
    true,
  );

  // The next run finds the finding it already tracks: the security review's
  // open finding is fixed when it no longer reproduces.
  const next = fakeGithub(
    { [SECURITY]: CLEAN, [QUALITY]: MINOR },
    github.comments,
  );
  await runAll(pair(next.fetch, discussing));
  const after = decodeState(next.comments[0].body, "security review");
  assertEquals(after?.findings.map((f) => f.status), ["fixed"]);
});

Deno.test("a reviewer moving into a panel keeps the state of its own old comment", async () => {
  const id = findingFingerprint("security", EVAL);
  const github = fakeGithub({ [SECURITY]: CLEAN, [QUALITY]: CLEAN }, [{
    id: 1,
    body: "<!-- zuke-ai-review:security review -->\nold report\n" +
      // The legacy, untagged block.
      encodeState({
        findings: [{
          id,
          title: EVAL.title,
          severity: "high",
          status: "open",
        }],
      }),
    user: { login: "github-actions[bot]", type: "Bot" },
    author_association: "NONE",
  }]);
  await runAll(pair(github.fetch, (r) => r.discussion()));
  const panel = github.comments.at(-1)?.body ?? "";
  const security = decodeState(panel, "security review");
  assertEquals(security?.findings.map((f) => [f.id, f.status]), [
    [id, "fixed"],
  ]);
});

Deno.test("a badge can be set, and every value the panel shows is escaped", async () => {
  const github = fakeGithub({ [SECURITY]: CLEAN, [QUALITY]: CLEAN });
  const [security, quality] = pair(github.fetch);
  security.badge("🔒");
  quality.name = "a|b <i>";
  await runAll([security, quality]);
  const body = github.comments[0].body;
  assertStringIncludes(body, "| 🔒 | security review |");
  assertStringIncludes(body, "| 🧹 | a\\|b <i> |");
  assertStringIncludes(body, "<b>a|b &lt;i&gt;</b>");
});

Deno.test("seatOf: a validation named twice acts alone, and a panel is per run", () => {
  const member = (peer: unknown): peer is { name: string } =>
    typeof peer === "object" && peer !== null && "name" in peer;
  const a = { name: "a" };
  const b = { name: "b" };
  assertEquals(seatOf(a, [a, a], member, "r", "t"), undefined);
  assertEquals(seatOf(a, [a, b, a], member, "r", "t"), undefined);
  assertEquals(seatOf(a, [a, b, b], member, "r", "t"), undefined);
  assertEquals(seatOf(a, [b], member, "r", "t"), undefined);
  const one = seatOf(a, [a, b], member, "run-1", "t");
  const other = seatOf(a, [a, b], member, "run-2", "t");
  const second = seatOf(b, [a, b], member, "run-1", "t");
  assertEquals(one?.last, false);
  assertEquals(second?.last, true);
  assertEquals(one?.panel === second?.panel, true);
  assertEquals(one?.panel === other?.panel, false);
});

Deno.test("renderPanel: a member that never reported fails the panel's verdict", () => {
  const panel = new Panel(["a", "b"]);
  panel.sections.set("a", {
    name: "a",
    badge: "🧹",
    verdict: "skipped",
    findings: [],
    skipped: "no API key",
    report: "_Skipped — no API key._",
  });
  assertStringIncludes(renderPanel(panel, "t"), "❌ **Failed**");
  panel.sections.set("b", {
    name: "b",
    badge: "🐛",
    verdict: "skipped",
    findings: [],
    skipped: "no API key",
    report: "_Skipped — no API key._",
  });
  assertStringIncludes(renderPanel(panel, "t"), "⏭️ **Skipped**");
  assertEquals(panel.failure(), undefined);
  // No findings table without findings.
  assertEquals(renderPanel(panel, "t").includes("### Findings"), false);
});

Deno.test("a refused member posts nothing and the panel still fails", async () => {
  const github = fakeGithub({ [SECURITY]: CLEAN, [QUALITY]: CLEAN });
  const [security, quality] = pair(github.fetch);
  // Without a provider every member throws before reporting.
  const bare = genericReviewer((r) => r.comment().fetch(github.fetch));
  const bare2 = securityReviewer((r) => r.comment().fetch(github.fetch));
  await assertRejects(
    async () => {
      const threw = await runAll([bare2, bare]);
      if (threw !== undefined) throw threw;
    },
    AiReviewError,
    "a provider is required",
  );
  assertEquals(github.comments.length, 0);
  // The fixtures above stay usable — nothing leaked into a later panel.
  assertEquals(await runAll([security, quality]), undefined);
  assertEquals(github.comments.length, 1);
});

Deno.test("a decision one member made this run reaches the next member before anything is posted", async () => {
  const id = findingFingerprint("security", EVAL);
  const github = fakeGithub({ [SECURITY]: FAILING, [QUALITY]: CLEAN }, [{
    id: 1,
    body: `@zuke-build accept ${id}: by design — eval runs in a sandbox`,
    user: { login: "maintainer", type: "User" },
    author_association: "MEMBER",
  }]);
  const threw = await runAll(
    pair(github.fetch, (r) => r.discussion((d) => d.commands("@zuke-build"))),
  );
  assertEquals(threw, undefined);
  // The security review accepted it; the generic review was told so in its
  // prompt, though the panel's comment did not exist yet.
  const quality = github.prompts.find((p) => p.includes(QUALITY)) ?? "";
  assertStringIncludes(quality, `${id} — ${EVAL.title}`);
  assertEquals(
    decodeState(github.comments.at(-1)?.body ?? "", "security review")
      ?.findings.map((f) => f.status),
    ["accepted"],
  );
});

Deno.test("two reviewers sharing a name act alone rather than overwrite each other", async () => {
  const github = fakeGithub({ [QUALITY]: FAILING });
  const base = (r: Reviewer) =>
    r.provider("claude").apiKey("k").comment().diff((d) => d.text(DIFF))
      .fetch(github.fetch);
  const strict = genericReviewer((r) => base(r).criteria("be strict"));
  const lenient = genericReviewer((r) => base(r).criteria("be lenient"));
  const threw = await runAll([strict, lenient]);
  assertEquals(threw instanceof AiReviewError, true);
  // The first one's failure stopped the list, as it always has for two
  // reviewers alone; its finding reached its own comment intact.
  assertEquals(
    github.comments.map((c) => c.body.split("\n")[0]),
    ["<!-- zuke-ai-review:generic review -->"],
  );
  assertStringIncludes(github.comments[0].body, "Eval of user input");
});

Deno.test("a comment token that fails costs the comment, never a member's failure", async () => {
  const github = fakeGithub({ [SECURITY]: FAILING, [QUALITY]: CLEAN });
  const [security, quality] = pair(github.fetch);
  quality.commentToken(() => Promise.reject(new Error("token boom")));
  const threw = await runAll([security, quality]);
  assertEquals(threw instanceof AiReviewError, true);
  assertStringIncludes(
    threw instanceof Error ? threw.message : "",
    'security review of "review" failed',
  );
  assertEquals(github.comments.length, 0);
});

Deno.test("a member's own panel comment is its state, even holding no block for it", async () => {
  const id = findingFingerprint("security", EVAL);
  // Its old comment from before the panel says the finding is open.
  const github = fakeGithub({ [SECURITY]: CLEAN, [QUALITY]: CLEAN }, [{
    id: 1,
    body: "<!-- zuke-ai-review:security review -->\nold report\n" +
      encodeState({
        findings: [{ id, title: EVAL.title, severity: "high", status: "open" }],
      }),
    user: { login: "github-actions[bot]", type: "Bot" },
    author_association: "NONE",
  }]);
  const discussing = (r: Reviewer) => r.discussion();
  // Run 1 marks it fixed; run 2 skips the security review (no key), so the
  // panel comment, updated in place, holds no block for it.
  await runAll(pair(github.fetch, discussing));
  const [, quality] = pair(github.fetch, discussing);
  const keyless = securityReviewer((r) =>
    discussing(
      r.provider("claude").apiKey("").skipIfKeyMissing().comment()
        .diff((d) => d.text(DIFF)).fetch(github.fetch),
    )
  );
  await runAll([keyless, quality]);
  assertEquals(
    decodeState(github.comments[1].body, "security review"),
    undefined,
  );
  // Run 3 starts fresh, as a reviewer alone would — it does not reach back
  // to the old comment's open finding and report it fixed all over again.
  await runAll(pair(github.fetch, discussing));
  assertEquals(
    decodeState(github.comments[1].body, "security review"),
    { findings: [] },
  );
});

Deno.test("a skipped member is counted in the verdict of a panel that passed", async () => {
  const github = fakeGithub({ [SECURITY]: CLEAN });
  const [security] = pair(github.fetch);
  const keyless = genericReviewer((r) =>
    r.provider("claude").apiKey("").skipIfKeyMissing().comment()
      .diff((d) => d.text(DIFF)).fetch(github.fetch)
  );
  await runAll([security, keyless]);
  assertStringIncludes(
    github.comments[0].body,
    "✅ **Passed** — no findings; 1 of 2 reviewers skipped.",
  );
});
