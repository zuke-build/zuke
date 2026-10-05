// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import { githubHost } from "../src/hosts/github.ts";
import { gitlabHost } from "../src/hosts/gitlab.ts";
import { azureHost, bitbucketHost } from "../src/hosts.ts";
import type { ReviewSignal } from "../src/hosts/types.ts";

/** Every signal, in a fixed order. */
const SIGNALS: readonly ReviewSignal[] = [
  "reviewing",
  "passed",
  "minor",
  "failed",
  "recovered",
  "fixed",
];

/** A recorded host call. */
interface Call {
  url: string;
  method: string;
  body: string;
}

/** A fake `fetch` answering each call with `answer`, recording it. */
function hostFetch(
  answer: (url: string, method: string) => Response,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(answer(url, method));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

const down = (() => Promise.reject(new Error("offline"))) as typeof fetch;

const githubEnv = (name: string): string | undefined =>
  ({
    GITHUB_REPOSITORY: "zuke-build/zuke",
    GITHUB_REF: "refs/pull/12/merge",
  })[name];

const GH_REACTIONS =
  "https://api.github.com/repos/zuke-build/zuke/issues/12/reactions";

/** GitHub's answer to a reaction POST: the reaction, with its author. */
const ghReaction = (id: number) =>
  new Response(
    JSON.stringify({ id, user: { login: "zuke-build[bot]" } }),
    { status: 201 },
  );

Deno.test("GitHub: each signal is a reaction on the description, 🤏 shown as 😕", async () => {
  const reactions = githubHost.reactions?.("tkn", githubEnv);
  assertEquals(reactions?.key, "github:zuke-build/zuke#12");
  const { fetch, calls } = hostFetch(() => ghReaction(5));
  for (const signal of SIGNALS) {
    assertEquals(await reactions?.add(signal, fetch), true);
  }
  assertEquals(calls.every((c) => c.url === GH_REACTIONS), true);
  assertEquals(calls.map((c) => JSON.parse(c.body).content), [
    "eyes",
    "+1",
    "confused",
    "-1",
    "hooray",
    "rocket",
  ]);
  const refused = hostFetch(() => new Response("{}", { status: 403 }));
  assertEquals(await reactions?.add("passed", refused.fetch), false);
  const noId = hostFetch(() => new Response("{}", { status: 201 }));
  assertEquals(await reactions?.add("passed", noId.fetch), false);
  assertEquals(await reactions?.add("passed", down), false);
});

Deno.test("GitHub: a withdrawal deletes only the reviewer's own reaction, and never creates one", async () => {
  const reactions = githubHost.reactions?.("tkn", githubEnv);
  // Before the reviewer has reacted it does not know its login: nothing is
  // listed, deleted, or — the point — posted.
  const blind = hostFetch(() => ghReaction(1));
  assertEquals(await reactions?.remove("failed", blind.fetch), false);
  assertEquals(blind.calls, []);
  await reactions?.add("reviewing", hostFetch(() => ghReaction(1)).fetch);
  const listing = [
    { id: 7, content: "-1", user: { login: "zuke-build[bot]" } },
    { id: 8, content: "-1", user: { login: "maintainer" } },
    { id: 9, content: "+1", user: { login: "zuke-build[bot]" } },
  ];
  const { fetch, calls } = hostFetch((_url, method) =>
    method === "GET"
      ? new Response(JSON.stringify(listing))
      : new Response(null, { status: 204 })
  );
  assertEquals(await reactions?.remove("failed", fetch), true);
  assertEquals(calls.map((c) => [c.method, c.url]), [
    ["GET", `${GH_REACTIONS}?content=-1&per_page=100`],
    ["DELETE", `${GH_REACTIONS}/7`],
  ]);
  // None of its own: nothing removed.
  const empty = hostFetch(() => new Response("[]"));
  assertEquals(await reactions?.remove("minor", empty.fetch), false);
});

Deno.test("GitHub: a failed listing or delete is false, never a throw", async () => {
  const reactions = githubHost.reactions?.("tkn", githubEnv);
  await reactions?.add("reviewing", hostFetch(() => ghReaction(1)).fetch);
  const listFails = hostFetch(() => new Response("{}", { status: 500 }));
  assertEquals(await reactions?.remove("failed", listFails.fetch), false);
  assertEquals(await reactions?.remove("failed", down), false);
  const deleteRefused = hostFetch((_url, method) =>
    method === "GET"
      ? new Response(
        JSON.stringify([
          { id: 3, content: "-1", user: { login: "zuke-build[bot]" } },
        ]),
      )
      : new Response("{}", { status: 404 })
  );
  assertEquals(await reactions?.remove("failed", deleteRefused.fetch), false);
});

Deno.test("GitHub: a reaction GitHub answers without an author teaches no login", async () => {
  const reactions = githubHost.reactions?.("tkn", githubEnv);
  const anonymous = hostFetch(() =>
    new Response(JSON.stringify({ id: 4 }), { status: 200 })
  );
  assertEquals(await reactions?.add("reviewing", anonymous.fetch), true);
  const after = hostFetch(() => new Response("[]"));
  assertEquals(await reactions?.remove("failed", after.fetch), false);
  assertEquals(after.calls, []);
});

Deno.test("GitHub: no pull request, no reactions", () => {
  const push = (name: string) =>
    ({ GITHUB_REPOSITORY: "a/b", GITHUB_REF: "refs/heads/master" })[name];
  assertEquals(githubHost.reactions?.("tkn", push), undefined);
});

const gitlabEnv = (name: string): string | undefined =>
  ({
    CI_PROJECT_ID: "42",
    CI_MERGE_REQUEST_IID: "3",
    CI_API_V4_URL: "https://gitlab.example/api/v4",
  })[name];

const GL_AWARDS =
  "https://gitlab.example/api/v4/projects/42/merge_requests/3/award_emoji";

Deno.test("GitLab: each signal is an award emoji on the merge request, 🤏 included", async () => {
  const reactions = gitlabHost.reactions?.("tkn", gitlabEnv);
  assertEquals(
    reactions?.key,
    "gitlab:https://gitlab.example/api/v4/projects/42!3",
  );
  const { fetch, calls } = hostFetch(() =>
    new Response(JSON.stringify({ id: 9 }), { status: 201 })
  );
  for (const signal of SIGNALS) {
    assertEquals(await reactions?.add(signal, fetch), true);
  }
  assertEquals(calls.every((c) => c.url === GL_AWARDS), true);
  assertEquals(calls.map((c) => JSON.parse(c.body).name), [
    "eyes",
    "thumbsup",
    "pinching_hand",
    "thumbsdown",
    "tada",
    "rocket",
  ]);
  // An award already given is showing, which is what was asked.
  const taken = hostFetch(() =>
    new Response(
      JSON.stringify({
        message: "404 Award Emoji Name has already been taken Not Found",
      }),
      { status: 404 },
    )
  );
  assertEquals(await reactions?.add("passed", taken.fetch), true);
  const refused = hostFetch(() => new Response("{}", { status: 403 }));
  assertEquals(await reactions?.add("passed", refused.fetch), false);
  assertEquals(await reactions?.add("passed", down), false);
});

Deno.test("GitLab: a withdrawal deletes only the token's own award of that name", async () => {
  const reactions = gitlabHost.reactions?.("tkn", gitlabEnv);
  const awards = [
    { id: 1, name: "eyes", user: { username: "project_42_bot1" } },
    { id: 2, name: "eyes", user: { username: "maintainer" } },
    { id: 3, name: "thumbsup", user: { username: "project_42_bot1" } },
    { id: "4", name: "eyes", user: { username: "project_42_bot1" } },
  ];
  const { fetch, calls } = hostFetch((url, method) => {
    if (url.endsWith("/user")) {
      return new Response(JSON.stringify({ username: "project_42_bot1" }));
    }
    if (method === "GET") return new Response(JSON.stringify(awards));
    return new Response(null, { status: 204 });
  });
  assertEquals(await reactions?.remove("reviewing", fetch), true);
  assertEquals(
    calls.filter((c) => c.method === "DELETE").map((c) => c.url),
    [`${GL_AWARDS}/1`],
  );
});

Deno.test("GitLab: an unknown identity, a failed listing or a refused delete is false", async () => {
  const reactions = gitlabHost.reactions?.("tkn", gitlabEnv);
  // No identity: nothing is listed, let alone deleted.
  const anonymous = hostFetch(() => new Response("{}", { status: 401 }));
  assertEquals(await reactions?.remove("passed", anonymous.fetch), false);
  assertEquals(anonymous.calls.length, 1);
  const blank = hostFetch(() => new Response(JSON.stringify({ username: "" })));
  assertEquals(await reactions?.remove("passed", blank.fetch), false);
  const self = () => new Response(JSON.stringify({ username: "me" }));
  const listFails = hostFetch((url) =>
    url.endsWith("/user") ? self() : new Response("{}", { status: 500 })
  );
  assertEquals(await reactions?.remove("passed", listFails.fetch), false);
  const deleteRefused = hostFetch((url, method) => {
    if (url.endsWith("/user")) return self();
    if (method === "GET") {
      return new Response(
        JSON.stringify([{ id: 8, name: "thumbsup", user: { username: "me" } }]),
      );
    }
    return new Response("{}", { status: 403 });
  });
  assertEquals(await reactions?.remove("passed", deleteRefused.fetch), false);
});

Deno.test("GitLab: no merge request, no reactions; Azure and Bitbucket have none", () => {
  assertEquals(gitlabHost.reactions?.("tkn", () => undefined), undefined);
  assertEquals(azureHost.reactions, undefined);
  assertEquals(bitbucketHost.reactions, undefined);
});
