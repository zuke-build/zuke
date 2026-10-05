// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The 🚀 a fixer puts on the pull-request description when it pushes a fix,
 * for both the AI fixer and the agent fixer, against a fake GitHub.
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import type { RemediationContext } from "@zuke/core";
import { type AgentFixer, agentFixer, type AiFixer, aiFixer } from "../mod.ts";
import { fakeReactions } from "./_reactions.ts";

const CTX: RemediationContext = {
  target: "test",
  attempt: 1,
  error: new Error("boom: a test failed"),
  redact: (text: string) => text,
};

const DESCRIPTION =
  "https://api.github.com/repos/zuke-build/zuke/issues/31/reactions";

/** A GitHub Actions run on pull request 31, with a token. */
const env = (name: string): string | undefined =>
  ({
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "zuke-build/zuke",
    GITHUB_REF: "refs/pull/31/merge",
    GITHUB_TOKEN: "tkn",
  })[name];

/**
 * A fake `fetch`: reactions go to a fresh {@link fakeReactions}, comment posts
 * answer an id, and anything else (the model) answers `provider`.
 */
function fakeGithub(provider = "{}") {
  const reactions = fakeReactions();
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const reaction = reactions.handle(url, init);
    if (reaction !== undefined) return reaction;
    if (url.startsWith("https://api.github.com/")) {
      const method = init?.method ?? "GET";
      return Promise.resolve(
        new Response(method === "GET" ? "[]" : JSON.stringify({ id: 1 })),
      );
    }
    return Promise.resolve(new Response(provider));
  }) as typeof fetch;
  return { fetch: impl, reactions };
}

/** A Claude response proposing one edit. */
const ONE_EDIT = JSON.stringify({
  content: [{
    type: "text",
    text: JSON.stringify({
      diagnosis: "off-by-one in loop",
      rootCause: "wrong bound",
      confidence: "high",
      edits: [{ path: "src/app.ts", content: "export const x = 1;\n" }],
    }),
  }],
  stop_reason: "end_turn",
});

/** An AI fixer that commits on a fake GitHub PR, with no disk or real git. */
function ai(doFetch: typeof fetch, extra: (f: AiFixer) => AiFixer): AiFixer {
  return extra(
    aiFixer((f) =>
      f.provider("claude").apiKey("k").commitFixes().allowCI()
        .conventions("").diff((d) => d.text("")).env(env)
        .exec(() => Promise.resolve(""))
        .write(() => Promise.resolve())
    ),
  ).fetch(doFetch).quiet();
}

Deno.test("the AI fixer reacts 🚀 once it has pushed a fix", async () => {
  const github = fakeGithub(ONE_EDIT);
  await ai(github.fetch, (f) => f).remediate(CTX);
  assertEquals(github.reactions.on(DESCRIPTION), ["rocket"]);
});

Deno.test("the AI fixer reacts nothing when it did not push, or does not comment", async () => {
  const unpushed = fakeGithub(ONE_EDIT);
  await ai(unpushed.fetch, (f) => f.noPush()).remediate(CTX);
  assertEquals(unpushed.reactions.on(DESCRIPTION), []);
  const silent = fakeGithub(ONE_EDIT);
  await ai(silent.fetch, (f) => f.noComment()).remediate(CTX);
  assertEquals(silent.reactions.on(DESCRIPTION), []);
});

/**
 * An agent fixer that commits on a fake GitHub PR; `dirty` is what the agent
 * leaves in `git status` after it ran.
 */
function agent(
  doFetch: typeof fetch,
  dirty: string,
  extra: (f: AgentFixer) => AgentFixer,
): AgentFixer {
  let status = 0;
  return extra(
    agentFixer(() => Promise.resolve(), (f) => f.commitFixes().allowCI())
      .conventions("").env(env).readFile(() => Promise.resolve(undefined))
      .exec((argv) =>
        Promise.resolve(argv[1] === "status" && status++ > 0 ? dirty : "")
      ),
  ).fetch(doFetch).quiet();
}

Deno.test("the agent fixer reacts 🚀 once it has pushed a fix", async () => {
  const github = fakeGithub();
  await agent(github.fetch, " M src/app.ts", (f) => f).remediate(CTX);
  assertEquals(github.reactions.on(DESCRIPTION), ["rocket"]);
});

Deno.test("the agent fixer reacts nothing when it changed nothing, did not push, or does not comment", async () => {
  const unchanged = fakeGithub();
  await agent(unchanged.fetch, "", (f) => f).remediate(CTX);
  assertEquals(unchanged.reactions.on(DESCRIPTION), []);
  const unpushed = fakeGithub();
  await agent(unpushed.fetch, " M src/app.ts", (f) => f.noPush())
    .remediate(CTX);
  assertEquals(unpushed.reactions.on(DESCRIPTION), []);
  const silent = fakeGithub();
  await agent(silent.fetch, " M src/app.ts", (f) => f.noComment())
    .remediate(CTX);
  assertEquals(silent.reactions.on(DESCRIPTION), []);
});

Deno.test("a fixer off a pull request reacts nothing, and does not fail", async () => {
  const github = fakeGithub(ONE_EDIT);
  const result = await aiFixer((f) =>
    f.provider("claude").apiKey("k").commitFixes()
      .conventions("").diff((d) => d.text("")).env(() => undefined)
      .exec(() => Promise.resolve(""))
      .write(() => Promise.resolve())
  ).fetch(github.fetch).quiet().remediate(CTX);
  assertEquals(result.retry, true);
  assertEquals(github.reactions.log, []);
});
