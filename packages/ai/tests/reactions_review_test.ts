// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A reviewer's progress reactions on the pull-request description, driven
 * through `validate(...)` against a fake GitHub. Each test uses its own pull
 * request number: the reviewers in a process share one progress record per
 * pull request, which is the point of it, so tests must not share one.
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import { AiReviewError, type Reviewer, securityReviewer } from "../mod.ts";
import type { Configure } from "@zuke/core/tooling";
import { withEnv } from "../../core/tests/_env.ts";
import { captureLines } from "../../core/tests/_console.ts";
import { noRedactionContext } from "./_context.ts";
import { fakeReactions } from "./_reactions.ts";

const DIFF = "diff --git a/src/app.ts b/src/app.ts\n" +
  "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n+const x = eval(input);\n";

/** A Claude Messages-API response carrying `assessment`. */
function claude(assessment: unknown): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(assessment) }],
    stop_reason: "end_turn",
  });
}

/** The description's reactions collection for pull request `pull`. */
const description = (pull: number) =>
  `https://api.github.com/repos/zuke-build/zuke/issues/${pull}/reactions`;

/**
 * Review pull request `pull` on a fake GitHub with `configure` applied. The
 * description starts with `seed` (the bot's reactions from an earlier run).
 * `provider` answers the model call; a `status` other than 200 makes it fail.
 * Resolves to every change made to the description's reactions
 * (`+content` / `-content`, in order), what is left on it, what the review
 * threw, and its console lines.
 */
async function review(
  pull: number,
  provider: string,
  configure: Configure<Reviewer> = (r) => r,
  status = 200,
  seed: string[] = [],
): Promise<
  { reactions: string[]; left: string[]; threw: unknown; lines: string[] }
> {
  const github = fakeReactions(
    seed.map((content) => ({ collection: description(pull), content })),
  );
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const reaction = github.handle(url, init);
    if (reaction !== undefined) return reaction;
    if (url.startsWith("https://api.github.com/")) {
      const method = init?.method ?? "GET";
      return Promise.resolve(
        new Response(method === "GET" ? "[]" : JSON.stringify({ id: 99 })),
      );
    }
    return Promise.resolve(new Response(provider, { status }));
  }) as typeof fetch;
  let threw: unknown;
  const lines = await captureLines(() =>
    withEnv({
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "zuke-build/zuke",
      GITHUB_REF: `refs/pull/${pull}/merge`,
      GITHUB_TOKEN: "tkn",
      GITHUB_STEP_SUMMARY: undefined,
    }, async () => {
      try {
        await securityReviewer((r) =>
          configure(
            r.provider("claude").apiKey("k").comment()
              .diff((d) => d.text(DIFF)).fetch(impl),
          )
        ).validate(noRedactionContext("deploy"));
      } catch (error) {
        threw = error;
      }
    })
  );
  return {
    reactions: github.log
      .filter((entry) => entry.collection === description(pull))
      .map((entry) => entry.change),
    left: github.on(description(pull)),
    threw,
    lines,
  };
}

Deno.test("a clean review shows 👀 while it runs, then 👍", async () => {
  const { reactions, threw } = await review(
    101,
    claude({ score: 0, severity: "none", findings: [] }),
  );
  assertEquals(threw, undefined);
  assertEquals(reactions, ["+eyes", "++1", "-eyes"]);
});

Deno.test("findings under the failing threshold show 🤏 (😕 on GitHub)", async () => {
  const { reactions, threw } = await review(
    102,
    claude({
      score: 3,
      severity: "low",
      findings: [{ title: "Nit", severity: "low", file: "src/app.ts" }],
    }),
  );
  assertEquals(threw, undefined);
  assertEquals(reactions, ["+eyes", "+confused", "-eyes"]);
});

Deno.test("a review that trips the gate shows 👎 and still fails the build", async () => {
  const { reactions, threw } = await review(
    103,
    claude({
      score: 9,
      severity: "high",
      findings: [{ title: "Eval", severity: "high", file: "src/app.ts" }],
    }),
  );
  assertEquals(threw instanceof AiReviewError, true);
  assertEquals(reactions, ["+eyes", "+-1", "-eyes"]);
});

Deno.test("an error under onError('fail') is a 👎; under 'warn' it is a skip, 👀 withdrawn", async () => {
  const failed = await review(104, "{}", (r) => r.retry({ attempts: 1 }), 500);
  assertEquals(failed.threw instanceof AiReviewError, true);
  assertEquals(failed.reactions, ["+eyes", "+-1", "-eyes"]);
  const warned = await review(
    105,
    "{}",
    (r) => r.retry({ attempts: 1 }).onError("warn"),
    500,
  );
  assertEquals(warned.threw, undefined);
  assertEquals(warned.reactions, ["+eyes", "-eyes"]);
});

Deno.test("reactions(false) or quiet() leaves the pull request alone", async () => {
  const clean = claude({ score: 0, severity: "none", findings: [] });
  assertEquals(
    (await review(106, clean, (r) => r.reactions(false))).reactions,
    [],
  );
  assertEquals((await review(107, clean, (r) => r.quiet())).reactions, []);
});

Deno.test("a token that cannot be minted skips the reactions, not the review", async () => {
  const { reactions, threw, lines } = await review(
    108,
    claude({ score: 0, severity: "none", findings: [] }),
    (r) => {
      let calls = 0;
      // The first resolution (the reactions) fails; the post that follows
      // gets a token.
      return r.commentToken(() =>
        calls++ === 0
          ? Promise.reject(new Error("App key rejected"))
          : Promise.resolve("app-token")
      );
    },
  );
  assertEquals(threw, undefined);
  assertEquals(reactions, []);
  assertEquals(
    lines.some((l) =>
      l.includes("could not react on the PR: App key rejected")
    ),
    true,
  );
});

Deno.test("a stale verdict is cleared, and a pass after a 👎 is 🎉", async () => {
  const { reactions, left } = await review(
    109,
    claude({ score: 0, severity: "none", findings: [] }),
    (r) => r,
    200,
    ["-1"],
  );
  assertEquals(reactions, ["+eyes", "--1", "+hooray", "-eyes"]);
  assertEquals(left, ["hooray"]);
});

Deno.test("a review skipped for want of a key still withdraws the last run's verdict", async () => {
  const { reactions, left } = await review(
    110,
    "{}",
    (r) => r.apiKey("").skipIfKeyMissing(),
    200,
    ["confused"],
  );
  assertEquals(reactions, ["+eyes", "-confused", "-eyes"]);
  assertEquals(left, []);
});
