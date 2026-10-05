// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Who may start a review with a comment command: the rules in `callers.ts`,
 * the GitHub host's lookup through `GhTasks`, and a reviewer refusing a
 * commenter before it spends anything.
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  type CommandCaller,
  commandCaller,
  mayStartReview,
  type Standing,
} from "../src/callers.ts";
import { authorizeGithubCommand } from "../src/hosts/github.ts";
import { AiReviewError, securityReviewer } from "../mod.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { captureLines } from "../../core/tests/_console.ts";
import { noRedactionContext } from "./_context.ts";
import { fakeReactions } from "./_reactions.ts";

/** A lookup answering `standing`, counting its calls. */
function lookup(standing: Standing) {
  const asked: string[] = [];
  return {
    asked,
    fn: (login: string) => {
      asked.push(login);
      return Promise.resolve(standing);
    },
  };
}

const caller = (overrides: Partial<CommandCaller> = {}): CommandCaller => ({
  actor: "mona",
  role: "write",
  users: [],
  ...overrides,
});

Deno.test("the role floor admits it and every role above it", async () => {
  for (const roleName of ["write", "maintain", "admin"]) {
    const { fn } = lookup({ permission: "write", roleName });
    assertEquals((await mayStartReview(caller(), fn)).allowed, true);
  }
  for (const roleName of ["read", "triage"]) {
    const { fn } = lookup({ permission: "read", roleName });
    const verdict = await mayStartReview(caller(), fn);
    assertEquals(verdict.allowed, false);
    assertEquals(
      verdict.reason,
      `mona has the ${roleName} role; starting a review needs write or above`,
    );
  }
  const { fn } = lookup({ permission: "read", roleName: "triage" });
  assertEquals(
    (await mayStartReview(caller({ role: "triage" }), fn)).allowed,
    true,
  );
});

Deno.test("a custom role is admitted by the base level the floor allows", async () => {
  const custom = (permission: string) =>
    lookup({ permission, roleName: "release-captain" }).fn;
  assertEquals((await mayStartReview(caller(), custom("write"))).allowed, true);
  assertEquals((await mayStartReview(caller(), custom("read"))).allowed, false);
  assertEquals(
    (await mayStartReview(caller({ role: "read" }), custom("read"))).allowed,
    true,
  );
  assertEquals(
    (await mayStartReview(caller({ role: "admin" }), custom("write"))).allowed,
    false,
  );
  assertEquals(
    (await mayStartReview(caller({ role: "admin" }), custom("admin"))).allowed,
    true,
  );
  // A triage floor cannot recognise a read-based custom role as triage-like.
  assertEquals(
    (await mayStartReview(caller({ role: "triage" }), custom("read"))).allowed,
    false,
  );
});

Deno.test("a named login is admitted before GitHub is asked", async () => {
  const { fn, asked } = lookup({ permission: "none", roleName: "none" });
  const verdict = await mayStartReview(caller({ users: ["mona"] }), fn);
  assertEquals(verdict, {
    allowed: true,
    reason: "mona is named as allowed to start a review",
  });
  assertEquals(asked, []);
});

Deno.test("every doubt refuses: a bad login, an unknown role, an unreadable answer", async () => {
  const { fn, asked } = lookup({ permission: "admin", roleName: "admin" });
  for (const actor of ["", "../evil", "a b"]) {
    assertEquals((await mayStartReview(caller({ actor }), fn)).allowed, false);
  }
  const unknown = await mayStartReview(caller({ role: undefined }), fn);
  assertEquals(unknown.allowed, false);
  assertEquals(unknown.reason.includes("names no role"), true);
  assertEquals(asked, []);
  const failing = await mayStartReview(
    caller(),
    () => Promise.reject(new Error("HTTP 403")),
  );
  assertEquals(failing.allowed, false);
  assertEquals(failing.reason.includes("could not read mona's role"), true);
  const thrown = await mayStartReview(
    caller(),
    () => Promise.reject("not an error"),
  );
  assertEquals(thrown.reason.includes("not an error"), true);
});

Deno.test("commandCaller reads the actor, the role and the logins from the env", () => {
  const env = (values: Record<string, string>) => (name: string) =>
    values[name];
  assertEquals(
    commandCaller(env({
      ZUKE_REVIEW_ACTOR: "mona",
      ZUKE_REVIEW_ROLE: "maintain",
      ZUKE_REVIEW_USERS: "alice, bob-2,,",
    })),
    { actor: "mona", role: "maintain", users: ["alice", "bob-2"] },
  );
  // Absent role is the default; one that is not a role reads as undefined.
  assertEquals(commandCaller(env({})), { actor: "", role: "write", users: [] });
  assertEquals(
    commandCaller(env({ ZUKE_REVIEW_ROLE: "" })).role,
    "write",
  );
  assertEquals(
    commandCaller(env({ ZUKE_REVIEW_ROLE: "owner" })).role,
    undefined,
  );
});

Deno.test("the GitHub host asks the collaborators API through GhTasks, only on a commanded run", async () => {
  const env = (values: Record<string, string>) => (name: string) =>
    values[name];
  assertEquals(authorizeGithubCommand(env({})), undefined);
  const authorize = authorizeGithubCommand(env({
    ZUKE_REVIEW_COMMENT: "1",
    ZUKE_REVIEW_ACTOR: "mona",
    GITHUB_REPOSITORY: "zuke-build/zuke",
  }));
  const urls: string[] = [];
  const answer = ((input: string | URL | Request) => {
    urls.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify({ permission: "write", role_name: "write" })),
    );
  }) as typeof fetch;
  assertEquals((await authorize?.("tkn", answer))?.allowed, true);
  assertEquals(urls, [
    "https://api.github.com/repos/zuke-build/zuke/collaborators/mona/permission",
  ]);
  // No repository: the lookup cannot be made, so the commenter is refused.
  const nowhere = authorizeGithubCommand(env({
    ZUKE_REVIEW_COMMENT: "1",
    ZUKE_REVIEW_ACTOR: "mona",
  }));
  assertEquals((await nowhere?.("tkn", answer))?.allowed, false);
});

/**
 * Run a comment-started review on a fake GitHub where the commenter has
 * `roleName`, and answer the reactions, the model calls and the log.
 */
async function commanded(
  comment: number,
  roleName: string,
  token: Record<string, string | undefined> = { GITHUB_TOKEN: "tkn" },
) {
  const github = fakeReactions();
  let modelCalls = 0;
  const authorizations: Array<string | null> = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const reaction = github.handle(url, init);
    if (reaction !== undefined) return reaction;
    if (url.endsWith("/collaborators/stranger/permission")) {
      authorizations.push(new Headers(init?.headers).get("authorization"));
      return Promise.resolve(
        new Response(
          JSON.stringify({ permission: "read", role_name: roleName }),
        ),
      );
    }
    if (url.startsWith("https://api.github.com/")) {
      return Promise.resolve(new Response("[]"));
    }
    modelCalls++;
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  let threw: unknown;
  const lines = await captureLines(() =>
    withEnv({
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "zuke-build/zuke",
      GITHUB_REF: "refs/heads/master",
      GITHUB_STEP_SUMMARY: undefined,
      ZUKE_REVIEW_PR: "61",
      ZUKE_REVIEW_COMMENT: String(comment),
      ZUKE_REVIEW_ACTOR: "stranger",
      GITHUB_TOKEN: undefined,
      ...token,
    }, async () => {
      try {
        await securityReviewer((r) =>
          r.provider("claude").apiKey("k").comment().commentToken("app-token")
            // The model answers nothing usable; the point is that it was asked.
            .onError("warn").retry({ attempts: 1 })
            .diff((d) => d.text("diff --git a/x b/x\n+x\n")).fetch(impl)
        ).validate(noRedactionContext("review"));
      } catch (error) {
        threw = error;
      }
    })
  );
  return {
    command: github.on(
      `https://api.github.com/repos/zuke-build/zuke/issues/comments/${comment}/reactions`,
    ),
    description: github.on(
      "https://api.github.com/repos/zuke-build/zuke/issues/61/reactions",
    ),
    modelCalls,
    authorizations,
    lines,
    threw,
  };
}

Deno.test("a refused commenter gets 😕 and a failed run: no review, no 👀", async () => {
  const { command, description, modelCalls, authorizations, threw } =
    await commanded(6161, "read");
  // Failing is what keeps the target's body from running for them.
  assertEquals(threw instanceof AiReviewError, true);
  assertEquals(
    threw instanceof Error ? threw.message : "",
    'security review of "review" was not started: stranger has the read ' +
      "role; starting a review needs write or above",
  );
  assertEquals(command, ["confused"]);
  assertEquals(description, []);
  assertEquals(modelCalls, 0);
  // Asked with the job's own token, not the comment token.
  assertEquals(authorizations, ["Bearer tkn"]);
});

Deno.test("without the job's token the lookup falls back to the comment token", async () => {
  const { authorizations, command } = await commanded(6162, "read", {
    GITHUB_TOKEN: undefined,
  });
  assertEquals(authorizations, ["Bearer app-token"]);
  assertEquals(command, ["confused"]);
});

Deno.test("an admitted commenter's review starts as before", async () => {
  const { command, modelCalls, threw, lines } = await commanded(6163, "write");
  assertEquals(threw, undefined);
  assertEquals(
    lines.some((l) => l.includes("stranger has the write role")),
    true,
  );
  assertEquals(command.includes("+1"), true);
  assertEquals(modelCalls > 0, true);
});

/**
 * A comment-started run's environment for `comment`, with the job's token and
 * a commenter GitHub reports as `roleName`, through `fetch` — which records
 * the authorization of every collaborators lookup and every reaction.
 */
function strangerRun(comment: number, roleName: string) {
  const github = fakeReactions();
  const lookups: Array<string | null> = [];
  const reactions: Array<string | null> = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get("authorization");
    if (url.endsWith("/collaborators/stranger/permission")) {
      lookups.push(authorization);
      return Promise.resolve(
        new Response(
          JSON.stringify({ permission: "read", role_name: roleName }),
        ),
      );
    }
    const reaction = github.handle(url, init);
    if (reaction !== undefined) {
      reactions.push(authorization);
      return reaction;
    }
    return Promise.resolve(new Response("[]"));
  }) as typeof globalThis.fetch;
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "zuke-build/zuke",
    GITHUB_REF: "refs/heads/master",
    GITHUB_STEP_SUMMARY: undefined,
    GITHUB_TOKEN: "job-token",
    ZUKE_REVIEW_PR: "62",
    ZUKE_REVIEW_COMMENT: String(comment),
    ZUKE_REVIEW_ACTOR: "stranger",
  };
  return { github, lookups, reactions, fetch, env };
}

Deno.test("a refusal never mints the comment token: 😕 goes out with the job's token", async () => {
  const run = strangerRun(6201, "read");
  let minted = 0;
  await captureLines(() =>
    withEnv(run.env, async () => {
      const reviewer = securityReviewer((r) =>
        r.provider("claude").apiKey("k").comment()
          .commentToken(() => {
            minted++;
            return Promise.resolve("app-token");
          })
          .diff((d) => d.text("diff")).fetch(run.fetch)
      );
      try {
        await reviewer.preflight(noRedactionContext("review"));
      } catch {
        // Refused, as asserted below.
      }
    })
  );
  assertEquals(minted, 0);
  assertEquals(run.lookups, ["Bearer job-token"]);
  assertEquals(run.reactions, ["Bearer job-token"]);
  assertEquals(
    run.github.on(
      "https://api.github.com/repos/zuke-build/zuke/issues/comments/6201/reactions",
    ),
    ["confused"],
  );
});

Deno.test("preflight refuses before anything else, and the run's reviewers share one lookup", async () => {
  const run = strangerRun(6202, "read");
  const errors: unknown[] = [];
  await captureLines(() =>
    withEnv(run.env, async () => {
      for (const make of [securityReviewer, securityReviewer]) {
        const reviewer = make((r) =>
          r.provider("claude").apiKey("k").comment()
            .diff((d) => d.text("diff")).fetch(run.fetch)
        );
        try {
          await reviewer.preflight({
            ...noRedactionContext("review"),
            runId: "r1",
          });
        } catch (error) {
          errors.push(error);
        }
      }
    })
  );
  assertEquals(errors.length, 2);
  assertEquals(errors.every((e) => e instanceof AiReviewError), true);
  assertEquals(run.lookups.length, 1);
  // Nothing on the pull request's description.
  assertEquals(
    run.github.on(
      "https://api.github.com/repos/zuke-build/zuke/issues/62/reactions",
    ),
    [],
  );
});

Deno.test("preflight is a no-op on a run no comment started", async () => {
  await withEnv(
    { GITHUB_ACTIONS: "true", ZUKE_REVIEW_COMMENT: undefined },
    async () => {
      await securityReviewer((r) => r.provider("claude").apiKey("k"))
        .preflight(noRedactionContext("review"));
    },
  );
});
