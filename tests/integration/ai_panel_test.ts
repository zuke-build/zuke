// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: two AI reviewers gating one real build through the CLI
 * `main()` post one combined pull-request comment — core hands them their
 * peers, nothing in the build declares a panel — and the first one failing
 * its gate neither stops the second from reviewing nor lets the body run.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { genericReviewer, securityReviewer } from "../../packages/ai/mod.ts";
import { runCli } from "./_harness.ts";
import { withEnv } from "../../packages/core/tests/_env.ts";
import { reacted, REACTIONS } from "../../packages/ai/tests/_reactions.ts";

const DIFF = "diff --git a/src/app.ts b/src/app.ts\n" +
  "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n+const x = eval(input);\n";
const COMMENTS =
  "https://api.github.com/repos/zuke-build/zuke/issues/9/comments";

/** A Claude Messages-API response carrying `assessment`. */
function claude(assessment: unknown): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(assessment) }],
    stop_reason: "end_turn",
  });
}

/**
 * A fake GitHub recording every comment posted, and a provider answering
 * from `responses` in order.
 */
function fakeGithub(responses: string[]) {
  const posted: string[] = [];
  let served = 0;
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (REACTIONS.test(url)) return reacted();
    if (url.startsWith("https://api.github.com/")) {
      const method = init?.method ?? "GET";
      if (method === "POST" && url === COMMENTS) {
        const body = typeof init?.body === "string" ? init.body : "{}";
        posted.push(String(JSON.parse(body).body));
      }
      return Promise.resolve(
        new Response(method === "GET" ? "[]" : JSON.stringify({ id: 1 })),
      );
    }
    const next = responses[Math.min(served++, responses.length - 1)];
    return Promise.resolve(new Response(next));
  }) as typeof fetch;
  return { fetch: impl, posted };
}

Deno.test("two reviewers of one target post one comment, and both review when the first fails", async () => {
  const github = fakeGithub([
    // The security review trips its gate.
    claude({
      score: 9,
      severity: "high",
      findings: [{ title: "Eval of input", severity: "high", file: "x.ts" }],
    }),
    // The generic review still runs: clean.
    claude({ score: 0, severity: "none", findings: [] }),
  ]);
  const executed: string[] = [];
  class Pipeline extends Build {
    security = securityReviewer((r) =>
      r.provider("claude").apiKey("k").comment()
        .diff((d) => d.text(DIFF)).fetch(github.fetch)
    );
    general = genericReviewer((r) =>
      r.provider("claude").apiKey("k").comment()
        .diff((d) => d.text(DIFF)).fetch(github.fetch)
    );
    review = target()
      .validateBefore(this.security, this.general)
      .executes(() => {
        executed.push("review");
      });
  }
  let result = { code: 0, err: "" };
  await withEnv({
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "zuke-build/zuke",
    GITHUB_REF: "refs/pull/9/merge",
    GITHUB_TOKEN: "tkn",
    GITHUB_STEP_SUMMARY: undefined,
  }, async () => {
    result = await runCli(Pipeline, ["review"]);
  });
  const { code, err } = result;
  assertEquals(code, 1);
  assertEquals(executed, []);
  assertStringIncludes(err, 'security review of "review" failed');
  assertEquals(github.posted.length, 1);
  const body = github.posted[0];
  assertStringIncludes(
    body,
    "<!-- zuke-ai-review:panel:security review + generic review -->",
  );
  assertStringIncludes(body, "| 🛡️ | security review | ❌ failed | 9/10 |");
  assertStringIncludes(body, "| 🧹 | generic review | ✅ passed | 0/10 |");
  assertStringIncludes(body, "| 🛡️ security review | high | Eval of input |");
});
