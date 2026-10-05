// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: two AI reviewers gating one real build through the CLI
 * `main()`, sharing one bot identity on a fake GitHub — proving that their
 * progress reactions on the pull-request description agree on one verdict
 * (the worst), that 👀 is gone once the run ends, and that a comment-started
 * run acknowledges its command with 👍.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { genericReviewer, securityReviewer } from "../../packages/ai/mod.ts";
import { runCli } from "./_harness.ts";
import { withEnv } from "../../packages/core/tests/_env.ts";

const DIFF = "diff --git a/src/app.ts b/src/app.ts\n" +
  "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n+const x = eval(input);\n";

/** A Claude Messages-API response carrying `assessment`. */
function claude(assessment: unknown): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(assessment) }],
    stop_reason: "end_turn",
  });
}

/**
 * A fake GitHub keeping the bot's reactions on pull request `pull`'s
 * description as a set — the way GitHub does, one per content per account —
 * and every reaction on comment `comment`. Provider calls are answered from
 * `responses` in order.
 */
function fakeGithub(pull: number, comment: number, responses: string[]) {
  const description = new Map<number, string>();
  const onComment: string[] = [];
  const timeline: string[] = [];
  let served = 0;
  let nextId = 1;
  const base = `https://api.github.com/repos/zuke-build/zuke/issues`;
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === `${base}/${pull}/reactions` && method === "POST") {
      const content = JSON.parse(String(init?.body)).content;
      for (const [id, held] of description) {
        if (held === content) {
          return Promise.resolve(new Response(JSON.stringify({ id })));
        }
      }
      const id = nextId++;
      description.set(id, content);
      timeline.push([...description.values()].sort().join(" "));
      return Promise.resolve(
        new Response(JSON.stringify({ id }), { status: 201 }),
      );
    }
    if (url.startsWith(`${base}/${pull}/reactions/`) && method === "DELETE") {
      description.delete(Number(url.slice(url.lastIndexOf("/") + 1)));
      timeline.push([...description.values()].sort().join(" "));
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url === `${base}/comments/${comment}/reactions`) {
      onComment.push(JSON.parse(String(init?.body)).content);
      return Promise.resolve(
        new Response(JSON.stringify({ id: nextId++ }), { status: 201 }),
      );
    }
    if (url.startsWith("https://api.github.com/")) {
      return Promise.resolve(
        new Response(method === "GET" ? "[]" : JSON.stringify({ id: 0 })),
      );
    }
    const next = responses[Math.min(served++, responses.length - 1)];
    return Promise.resolve(new Response(next));
  }) as typeof fetch;
  return {
    fetch: impl,
    description: () => [...description.values()].sort(),
    onComment,
    timeline,
  };
}

Deno.test("two reviewers in one build show one verdict — the worst — and 👀 only while they run", async () => {
  const github = fakeGithub(801, 4242, [
    // The security review: one low finding, under the gate.
    claude({
      score: 3,
      severity: "low",
      findings: [{ title: "Nit", severity: "low", file: "src/app.ts" }],
    }),
    // The generic review: clean.
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
    deploy = target()
      .validateBefore(this.security, this.general)
      .executes(() => {
        executed.push("deploy");
        return Promise.resolve();
      });
  }

  await withEnv(
    {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "zuke-build/zuke",
      GITHUB_REF: "refs/heads/master",
      GITHUB_TOKEN: "tkn",
      GITHUB_STEP_SUMMARY: undefined,
      ZUKE_REVIEW_PR: "801",
      ZUKE_REVIEW_COMMENT: "4242",
    },
    async () => {
      const result = await runCli(Pipeline, ["deploy"]);
      assertEquals(result.code, 0);
    },
  );

  assertEquals(executed, ["deploy"]);
  // The command was acknowledged with 👍, once per reviewer — one reaction on
  // GitHub, which keeps one per content per account.
  assertEquals(github.onComment, ["+1", "+1"]);
  // The clean generic review did not paper over the security review's
  // finding, and nothing says the run is still going.
  assertEquals(github.description(), ["confused"]);
  // 👀 was up while the reviews ran.
  assertEquals(github.timeline.includes("eyes"), true);
});

Deno.test("a reviewer that fails the build leaves 👎", async () => {
  const github = fakeGithub(802, 1, [
    claude({
      score: 9,
      severity: "high",
      findings: [{ title: "Eval", severity: "high", file: "src/app.ts" }],
    }),
  ]);
  const executed: string[] = [];
  class Pipeline extends Build {
    security = securityReviewer((r) =>
      r.provider("claude").apiKey("k").comment()
        .diff((d) => d.text(DIFF)).fetch(github.fetch)
    );
    deploy = target()
      .validateBefore(this.security)
      .executes(() => {
        executed.push("deploy");
        return Promise.resolve();
      });
  }

  await withEnv(
    {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "zuke-build/zuke",
      GITHUB_REF: "refs/pull/802/merge",
      GITHUB_TOKEN: "tkn",
      GITHUB_STEP_SUMMARY: undefined,
      ZUKE_REVIEW_COMMENT: undefined,
      ZUKE_REVIEW_PR: undefined,
    },
    async () => {
      const result = await runCli(Pipeline, ["deploy"]);
      assertEquals(result.code === 0, false);
    },
  );

  assertEquals(executed, []);
  assertEquals(github.description(), ["-1"]);
  // Not comment-started: no command to acknowledge.
  assertEquals(github.onComment, []);
});
