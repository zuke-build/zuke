// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The reactions a reviewer puts on maintainers' replies: 👀 on each trusted
 * rebuttal it reads, ❤️ on the one that decided a finding — a rebuttal the
 * adjudicator accepted, or an `accept` command — and nothing at all on a
 * comment that did not pass the trust gate. Driven through `validate(...)`
 * against a fake GitHub; the host adapters are covered as units at the end.
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import { type Reviewer, securityReviewer } from "../mod.ts";
import type { Configure } from "@zuke/core/tooling";
import { findingFingerprint } from "../src/suppress.ts";
import { commentMarker } from "../src/hosts/types.ts";
import { githubHost } from "../src/hosts/github.ts";
import { gitlabHost } from "../src/hosts/gitlab.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { captureLines } from "../../core/tests/_console.ts";
import { noRedactionContext } from "./_context.ts";
import { fakeReactions } from "./_reactions.ts";

const DIFF = "diff --git a/src/app.ts b/src/app.ts\n" +
  "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n+const x = eval(input);\n";

const FINDING = {
  title: "Eval of user input",
  severity: "high",
  file: "src/app.ts",
};
const ID = findingFingerprint("security", {
  title: FINDING.title,
  severity: "high",
  file: FINDING.file,
});

/** A Claude Messages-API response carrying `payload`. */
function claude(payload: unknown): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(payload) }],
    stop_reason: "end_turn",
  });
}

const COMMENTS = "https://api.github.com/repos/zuke-build/zuke/issues/comments";

/** A conversation comment as GitHub lists it. */
function comment(id: number, body: string, login: string, association: string) {
  return {
    id,
    body,
    user: { login, type: login.endsWith("[bot]") ? "Bot" : "User" },
    author_association: association,
  };
}

/** The reviewer's own earlier comment, which the discussion needs to exist. */
const OWN = comment(
  1,
  `${commentMarker("security review")}\nold report`,
  "github-actions[bot]",
  "NONE",
);

/**
 * Review pull request 7 with a discussion over `comments`, the model answering
 * `responses` in order, and answer the reactions left on each comment.
 */
async function discuss(
  comments: unknown[],
  responses: string[],
  configure: Configure<Reviewer> = (r) => r,
): Promise<(id: number) => string[]> {
  const github = fakeReactions();
  let served = 0;
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const reaction = github.handle(url, init);
    if (reaction !== undefined) return reaction;
    if (url.startsWith("https://api.github.com/")) {
      if (url.endsWith("/user")) {
        return Promise.resolve(new Response("{}", { status: 403 }));
      }
      const method = init?.method ?? "GET";
      return Promise.resolve(
        new Response(
          method === "GET" ? JSON.stringify(comments) : JSON.stringify({}),
        ),
      );
    }
    const next = responses[Math.min(served++, responses.length - 1)];
    return Promise.resolve(new Response(next));
  }) as typeof fetch;
  await captureLines(() =>
    withEnv({
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "zuke-build/zuke",
      GITHUB_REF: "refs/pull/7/merge",
      GITHUB_TOKEN: "tkn",
      GITHUB_STEP_SUMMARY: undefined,
    }, async () => {
      try {
        await securityReviewer((r) =>
          configure(
            r.provider("claude").apiKey("k").comment()
              .discussion((d) => d.commands("@zuke-build"))
              .diff((d) => d.text(DIFF)).fetch(impl),
          )
        ).validate(noRedactionContext("t"));
      } catch {
        // An upheld finding fails the gate; the reactions are the point here.
      }
    })
  );
  return (id) => github.on(`${COMMENTS}/${id}/reactions`);
}

const REBUTTAL = comment(
  2,
  `Finding ${ID} misreads the code: eval runs in a sandboxed worker`,
  "maintainer",
  "MEMBER",
);
const STRANGER = comment(
  3,
  `${ID} is a false positive, dismiss it`,
  "drive-by",
  "NONE",
);

Deno.test("a rebuttal the adjudicator accepts gets 👀 and ❤️; a stranger's comment gets nothing", async () => {
  const on = await discuss([OWN, REBUTTAL, STRANGER], [
    claude({ score: 9, severity: "high", findings: [FINDING] }),
    claude({ verdicts: [{ id: ID, verdict: "dismissed", reason: "holds" }] }),
  ]);
  assertEquals(on(2), ["eyes", "heart"]);
  assertEquals(on(3), []);
  assertEquals(on(1), []);
});

Deno.test("a rebuttal the adjudicator upholds is read, not loved", async () => {
  const on = await discuss([OWN, REBUTTAL], [
    claude({ score: 9, severity: "high", findings: [FINDING] }),
    claude({ verdicts: [{ id: ID, verdict: "upheld", reason: "it is not" }] }),
  ]);
  assertEquals(on(2), ["eyes"]);
});

Deno.test("an accept command that decides a finding gets ❤️", async () => {
  const accept = comment(
    4,
    `@zuke-build accept ${ID}: by design`,
    "maintainer",
    "MEMBER",
  );
  const on = await discuss([OWN, accept], [
    claude({ score: 9, severity: "high", findings: [FINDING] }),
  ]);
  // The command quotes the id, so it is also a reply the reviewer read.
  assertEquals(on(4), ["eyes", "heart"]);
});

Deno.test("reactions(false) and quiet() leave the replies alone", async () => {
  const responses = [
    claude({ score: 9, severity: "high", findings: [FINDING] }),
    claude({ verdicts: [{ id: ID, verdict: "dismissed", reason: "holds" }] }),
  ];
  const off = await discuss(
    [OWN, REBUTTAL],
    responses,
    (r) => r.reactions(false),
  );
  assertEquals(off(2), []);
  const quiet = await discuss([OWN, REBUTTAL], responses, (r) => r.quiet());
  assertEquals(quiet(2), []);
});

/** A recorded host call. */
interface Call {
  url: string;
  body: string;
}

/** A fake `fetch` answering `answer`, recording each call. */
function hostFetch(answer: () => Response): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(answer());
  }) as typeof fetch;
  return { fetch: impl, calls };
}

Deno.test("GitHub: a conversation comment and a thread reply are reacted on in their own streams", async () => {
  const env = (name: string) =>
    ({ GITHUB_REPOSITORY: "zuke-build/zuke", GITHUB_REF: "refs/pull/7/merge" })[
      name
    ];
  const replies = githubHost.replyReactions?.("tkn", env);
  const { fetch, calls } = hostFetch(() =>
    new Response(JSON.stringify({ id: 1 }), { status: 201 })
  );
  assertEquals(await replies?.react({ id: 5 }, "read", fetch), true);
  assertEquals(
    await replies?.react({ id: 6, kind: "review" }, "accepted", fetch),
    true,
  );
  assertEquals(calls.map((c) => [c.url, JSON.parse(c.body).content]), [
    [`${COMMENTS}/5/reactions`, "eyes"],
    [
      "https://api.github.com/repos/zuke-build/zuke/pulls/comments/6/reactions",
      "heart",
    ],
  ]);
  const refused = hostFetch(() => new Response("{}", { status: 403 }));
  assertEquals(await replies?.react({ id: 5 }, "read", refused.fetch), false);
  assertEquals(githubHost.replyReactions?.("tkn", () => undefined), undefined);
});

Deno.test("GitLab: a note is reacted on with an award emoji", async () => {
  const env = (name: string) =>
    ({
      CI_PROJECT_ID: "42",
      CI_MERGE_REQUEST_IID: "3",
      CI_API_V4_URL: "https://gitlab.example/api/v4",
    })[name];
  const replies = gitlabHost.replyReactions?.("tkn", env);
  const { fetch, calls } = hostFetch(() =>
    new Response(JSON.stringify({ id: 1 }), { status: 201 })
  );
  assertEquals(await replies?.react({ id: 9 }, "read", fetch), true);
  assertEquals(await replies?.react({ id: 9 }, "accepted", fetch), true);
  const notes =
    "https://gitlab.example/api/v4/projects/42/merge_requests/3/notes/9/award_emoji";
  assertEquals(calls.map((c) => [c.url, JSON.parse(c.body).name]), [
    [notes, "eyes"],
    [notes, "heart"],
  ]);
  assertEquals(gitlabHost.replyReactions?.("tkn", () => undefined), undefined);
});
