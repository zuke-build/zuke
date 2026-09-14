// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for the redaction on `@zuke/ai`'s publish paths.
 *
 * `remediation_redact_test.ts` proves core hands a remediation a working
 * redactor. This proves the remediation that most needs it — the AI fixer,
 * which publishes to a pull request — actually calls it, over a whole build
 * run: a declared secret, a failing target, and the real
 * `postComment` / `postGithubSuggestions` path with only `fetch` faked.
 *
 * The seam asserted on is the request body, because that is the thing a
 * regression changes. A comment cannot be taken back once it is sent — it is
 * already in the notification mails and the API history — so "did it leave the
 * process" is the only question worth asking.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { aiFixer } from "../../packages/ai/mod.ts";
import { runCli } from "./_harness.ts";

/**
 * The value the build declares secret, and which comes back in the reply.
 *
 * A canary rather than a credential-shaped literal: it only has to be
 * distinctive enough to search request bodies for, and a realistic-looking
 * token here is a hard-coded-credentials finding in every scanner that reads
 * this file, for no gain in what the test proves.
 */
const CANARY = "canary-value-that-must-not-escape";

/** An environment that looks like an Actions runner on a pull request. */
const PR_ENV: Record<string, string> = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_REF: "refs/pull/7/merge",
  GITHUB_TOKEN: "tok",
};

/**
 * A model reply whose diagnosis quotes the secret — what happens when the
 * prompt carries a failed command that had the credential on it.
 */
const FIX = JSON.stringify({
  content: [{
    type: "text",
    text: JSON.stringify({
      diagnosis: `the call failed because ${CANARY} expired`,
      rootCause: "expired credential",
      confidence: "high",
      edits: [{ path: "src/app.ts", content: "export const x = 1;\n" }],
    }),
  }],
  stop_reason: "end_turn",
});

/** One request that left the process. */
interface Sent {
  url: string;
  body: string;
}

/**
 * The host a request went to.
 *
 * Parsed and compared whole rather than matched with `url.includes(host)`:
 * a substring test also matches a URL that merely mentions the host somewhere
 * else, such as `https://example.invalid/?to=api.github.com`, so it is the
 * wrong test even where the inputs happen to be ours.
 */
function hostOf(url: string): string {
  return new URL(url).hostname;
}

Deno.test("the AI fixer never puts a declared secret in a PR comment", async () => {
  const sent: Sent[] = [];
  const writes: string[] = [];

  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (typeof init?.body === "string") sent.push({ url, body: init.body });
    // The model call, then GitHub: list the comments, then create one.
    if (hostOf(url) === "api.anthropic.com") {
      return Promise.resolve(new Response(FIX, { status: 200 }));
    }
    const method = init?.method ?? "GET";
    return Promise.resolve(
      new Response(method === "GET" ? "[]" : "{}", { status: 200 }),
    );
  }) as typeof fetch;

  class Healing extends Build {
    canary = parameter("canary").secret().default(CANARY);

    lint = target()
      .recoverWith(
        aiFixer((f) => f.provider("claude").apiKey("k").autoApply())
          .conventions("")
          .diff((d) => d.text(""))
          .exec(() => Promise.resolve(""))
          .write((path) => {
            writes.push(path);
            return Promise.resolve();
          })
          .fetch(fetchImpl)
          .env((n) => PR_ENV[n])
          .quiet(),
      )
      .executes(() => {
        if (writes.length === 0) throw new Error("lint failed");
      });
  }

  const { code } = await runCli(Healing, ["lint"]);

  // Red, and deliberately so: this is the default scope on CI, which diagnoses
  // and declines the write. That is the configuration the leak mattered in —
  // it publishes the model's diagnosis to the pull request without ever
  // touching the tree, so the comment goes out on a run that "changed nothing".
  assertEquals(code, 1);
  assertEquals(writes, []);

  // The fixer really did reach the comment API: without this the assertion
  // below would pass vacuously on a run that never published at all.
  const comments = sent.filter((s) => hostOf(s.url) === "api.github.com");
  assertEquals(comments.length, 1);

  // The diagnosis quoted the secret, so a comment that skipped the redactor
  // would carry it.
  assertEquals(comments[0].body.includes("expired"), true);

  // Nothing that left the process carries the secret — the comment, and the
  // request to the model, which is built from the failure rather than the reply.
  for (const { url, body } of sent) {
    assertEquals(body.includes(CANARY), false, url);
  }
});
