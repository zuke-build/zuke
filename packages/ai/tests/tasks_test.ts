// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `AiTasks`: the reviewers run as peers of one target from a task call, as a
 * target's `.validateBefore(...)` list runs them; a tripped gate fails the
 * call; the preflight is a no-op off a comment-started run.
 *
 * @module
 */

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { AiReviewError, AiTasks, ReviewSettings } from "../mod.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { captureLines } from "../../core/tests/_console.ts";

const DIFF = "diff --git a/src/app.ts b/src/app.ts\n" +
  "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n+const x = eval(input);\n";

/** An OpenAI response carrying `assessment`, as the provider answers it. */
function openai(assessment: Record<string, unknown>): string {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify(assessment) } }],
  });
}

/** A fake `fetch` answering every provider call with `body`, counting them. */
function answering(body: string): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

Deno.test("ReviewSettings names the target and adds a reviewer per kind, in order", () => {
  const settings = new ReviewSettings()
    .target("gate")
    .security()
    .generic()
    .secrets()
    .correctness()
    .license();
  assertEquals(settings.target_, "gate");
  assertEquals(
    settings.reviewers_.map((r) => r.name),
    [
      "security review",
      "generic review",
      "secrets review",
      "correctness review",
      "license review",
    ],
  );
  assertEquals(new ReviewSettings().target_, "review");
});

Deno.test("AiTasks.review runs every reviewer against the provider and passes under the gate", async () => {
  const { fetch, calls } = answering(
    openai({ score: 2, severity: "low", summary: "fine", findings: [] }),
  );
  await withEnv({ GITHUB_STEP_SUMMARY: undefined }, async () => {
    await captureLines(() =>
      AiTasks.review((r) =>
        r.security((s) =>
          s.provider("openai").apiKey("k").quiet().diff((d) => d.text(DIFF))
            .fetch(fetch)
        ).generic((s) =>
          s.provider("openai").apiKey("k").quiet().diff((d) => d.text(DIFF))
            .fetch(fetch)
        )
      )
    );
  });
  assertEquals(calls, [
    "https://api.openai.com/v1/chat/completions",
    "https://api.openai.com/v1/chat/completions",
  ]);
});

Deno.test("AiTasks.review fails the call when a reviewer's gate trips", async () => {
  const { fetch } = answering(
    openai({
      score: 9,
      severity: "critical",
      summary: "eval of input",
      findings: [],
    }),
  );
  await withEnv({ GITHUB_STEP_SUMMARY: undefined }, async () => {
    await captureLines(async () => {
      await assertRejects(
        () =>
          AiTasks.review((r) =>
            r.security((s) =>
              s.provider("openai").apiKey("k").quiet()
                .diff((d) => d.text(DIFF)).fetch(fetch)
                .failWhen((g) => g.scoreAbove(5))
            )
          ),
        AiReviewError,
      );
    });
  });
});

Deno.test("AiTasks.preflight is a no-op off a comment-started run", async () => {
  await withEnv(
    { ZUKE_REVIEW_PR: undefined, ZUKE_REVIEW_COMMENT: undefined },
    () =>
      AiTasks.preflight((r) =>
        r.security((s) => s.provider("openai").apiKey("k").quiet())
      ),
  );
});
