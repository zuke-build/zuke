/**
 * Integration: an AI reviewer gating a real build through the CLI `main()`,
 * with the provider, the PR-comment API, and git all faked at their seams —
 * proving the review pipeline (deep passes, discussion, injection guards)
 * works as a whole when driven exactly the way `./zuke <target>` drives it.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { securityReviewer } from "../../packages/ai/mod.ts";
import { findingFingerprint } from "../../packages/ai/src/suppress.ts";
import { decodeState, encodeState } from "../../packages/ai/src/state.ts";
import { commentMarker } from "../../packages/ai/src/hosts/types.ts";
import { runCli } from "./_harness.ts";

const DIFF = "diff --git a/src/app.ts b/src/app.ts\n" +
  "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n+const x = eval(input);\n";

const FINDING = {
  title: "Eval of user input",
  severity: "high",
  file: "src/app.ts",
};
const ID = findingFingerprint("security", {
  title: "Eval of user input",
  severity: "high",
  file: "src/app.ts",
});
const MARKER = commentMarker("security review");

/** Wrap a payload in a Claude Messages-API response body. */
function claude(payload: unknown): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(payload) }],
    stop_reason: "end_turn",
  });
}

/** A recorded call made by the reviewer during the build. */
interface Call {
  url: string;
  method: string;
  body: string;
}

/**
 * A fake `fetch`: GitHub comment listings return `comments`, writes return
 * `{}`, `/user` fails like an Actions installation token, and provider calls
 * are served from `responses` in order.
 */
function fakeFetch(
  comments: unknown[],
  responses: string[],
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let served = 0;
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (url.includes("api.github.com")) {
      if (url.endsWith("/user")) {
        return Promise.resolve(new Response("{}", { status: 403 }));
      }
      const payload = method === "GET" ? JSON.stringify(comments) : "{}";
      return Promise.resolve(new Response(payload, { status: 200 }));
    }
    const next = responses[Math.min(served++, responses.length - 1)];
    return Promise.resolve(new Response(next, { status: 200 }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/** Run `fn` with env vars set, restoring the previous values after. */
async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const prior = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    prior.set(key, Deno.env.get(key));
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
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

Deno.test("a reviewer with verify + discussion gates a real build via the CLI", async () => {
  // The reviewer re-reports a finding a maintainer already refuted (state in
  // the bot's prior comment) and finds nothing else: the build must pass, the
  // comment must be updated in place, and the state must survive the round.
  const priorBody = `${MARKER}\nold report\n${
    encodeState({
      findings: [{
        id: ID,
        title: FINDING.title,
        severity: "high",
        status: "dismissed",
        rationale: "eval runs in a sandboxed worker",
        author: "maintainer",
      }],
    })
  }`;
  const comments = [{
    id: 11,
    body: priorBody,
    user: { login: "github-actions[bot]", type: "Bot" },
    author_association: "NONE",
  }];
  const { fetch, calls } = fakeFetch(comments, [
    claude({ score: 9, severity: "high", findings: [FINDING] }),
  ]);

  const executed: string[] = [];
  class Pipeline extends Build {
    review = securityReviewer((r) =>
      r.provider("claude").apiKey("test-key")
        .comment().discussion()
        .diff((d) => d.text(DIFF))
        .fetch(fetch)
    );
    deploy = target()
      .description("Deploy, gated by the AI review")
      .validateBefore(this.review)
      .executes(() => {
        executed.push("deploy");
        return Promise.resolve();
      });
  }

  await withEnv(
    {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "zuke-build/zuke",
      GITHUB_REF: "refs/pull/7/merge",
      GITHUB_TOKEN: "tkn",
      GITHUB_STEP_SUMMARY: undefined,
    },
    async () => {
      const result = await runCli(Pipeline, ["deploy"]);
      // The dismissed finding must not gate: the target ran and the build passed.
      assertEquals(result.code, 0);
      assertEquals(executed, ["deploy"]);
      // The dismissal stayed visible in the report, never silent.
      assertEquals(
        result.out.includes("dismissed via discussion by maintainer"),
        true,
      );
    },
  );

  // The comment was updated in place (the bot-authored one), carrying state.
  const write = calls.find((c) =>
    c.url.includes("api.github.com") && c.method !== "GET"
  );
  assertEquals(write?.method, "PATCH");
  assertEquals(write?.url.endsWith("/issues/comments/11"), true);
  const state = decodeState(JSON.parse(write?.body ?? "{}").body);
  assertEquals(state?.findings[0].status, "dismissed");
});

Deno.test("an open high finding still fails the build through the CLI", async () => {
  // Same pipeline, but no prior discussion: the finding gates, the target
  // never runs, and the failure names the review.
  const { fetch } = fakeFetch([], [
    claude({ score: 9, severity: "high", findings: [FINDING] }),
  ]);
  const executed: string[] = [];
  class Pipeline extends Build {
    review = securityReviewer((r) =>
      r.provider("claude").apiKey("test-key")
        .diff((d) => d.text(DIFF))
        .fetch(fetch)
    );
    deploy = target()
      .validateBefore(this.review)
      .executes(() => {
        executed.push("deploy");
        return Promise.resolve();
      });
  }
  await withEnv({ GITHUB_STEP_SUMMARY: undefined }, async () => {
    const result = await runCli(Pipeline, ["deploy"]);
    assertEquals(result.code, 1);
    assertEquals(executed, []);
    assertEquals(result.err.includes("security review"), true);
  });
});
