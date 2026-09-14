// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for the redaction on the AI reviewer's publish paths.
 *
 * The unit tests drive `validate` with a context they construct themselves, so
 * they prove the reviewer masks with whatever redactor it is handed. This
 * proves the rest of the chain: that a real run hands it a working one at all.
 * A reviewer is a validation, and until the seam existed a validation's context
 * carried nothing but the target's name — so "core actually supplies it" is the
 * half that is worth asserting through a whole build.
 *
 * The seam asserted on is the request body, because that is what a regression
 * changes. A pull-request comment cannot be taken back once it is sent.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { securityReviewer } from "../../packages/ai/mod.ts";
import { hostOf, runCli } from "./_harness.ts";

/** The value the build declares secret, which comes back in the assessment. */
const CANARY = "review-value-that-must-not-escape";

/** An environment that looks like an Actions runner on a pull request. */
const PR_ENV: Record<string, string> = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_REF: "refs/pull/7/merge",
  GITHUB_TOKEN: "tok",
};

const DIFF = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,1 +1,2 @@",
  " one",
  "+const x = 1;",
].join("\n");

/**
 * A model reply whose finding quotes the secret — what happens when the prompt
 * carried a diff or a command output the credential appeared in. The score is
 * below the default gate, so the build passes and the comment still goes out:
 * a run that "changed nothing" is exactly where an unmasked comment would slip
 * by unnoticed.
 */
const ASSESSMENT = JSON.stringify({
  content: [{
    type: "text",
    text: JSON.stringify({
      score: 1,
      severity: "low",
      findings: [{
        title: `stray credential ${CANARY} in the diff`,
        severity: "low",
        file: "src/app.ts",
      }],
    }),
  }],
  stop_reason: "end_turn",
});

/** One request that left the process. */
interface Sent {
  url: string;
  body: string;
}

Deno.test("the AI reviewer never puts a declared secret on the pull request", async () => {
  const sent: Sent[] = [];

  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (typeof init?.body === "string") sent.push({ url, body: init.body });
    if (hostOf(url) === "api.anthropic.com") {
      return Promise.resolve(new Response(ASSESSMENT, { status: 200 }));
    }
    if (url.endsWith("/user")) {
      return Promise.resolve(new Response("{}", { status: 403 }));
    }
    return Promise.resolve(
      new Response(method === "GET" ? "[]" : "{}", { status: 200 }),
    );
  }) as typeof fetch;

  class Reviewed extends Build {
    key = parameter("key").secret().default(CANARY);

    lint = target()
      .validateAfter(
        securityReviewer((r) =>
          r.provider("claude").apiKey("k")
            .comment()
            .diff((d) => d.text(DIFF))
            .fetch(fetchImpl)
            .env((n) => PR_ENV[n])
        ),
      )
      .executes(() => {});
  }

  const { code } = await runCli(Reviewed, ["lint"]);
  // Green: the score is under the gate, so the reviewer reports without failing
  // the target — and still publishes.
  assertEquals(code, 0);

  // It really did reach the comment API, so the assertion below is not vacuous.
  const posted = sent.filter((s) => hostOf(s.url) === "api.github.com");
  assertEquals(posted.length, 1);
  assertEquals(posted[0].body.includes("stray credential"), true);

  // Nothing that left the process carries the secret.
  for (const { url, body } of sent) {
    assertEquals(body.includes(CANARY), false, url);
  }
});
