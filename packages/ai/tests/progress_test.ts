// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import { ReviewProgress } from "../src/progress.ts";
import { githubHost } from "../src/hosts/github.ts";
import { gitlabHost } from "../src/hosts/gitlab.ts";
import { azureHost, bitbucketHost } from "../src/hosts.ts";
import type { ReviewReactions, ReviewSignal } from "../src/hosts/types.ts";

/** A fake {@link ReviewReactions} recording `+signal` / `-signal` in order. */
function recorder(key = "pr"): { reactions: ReviewReactions; log: string[] } {
  const log: string[] = [];
  const record = (mark: string) => (signal: ReviewSignal) => {
    log.push(`${mark}${signal}`);
    return Promise.resolve(true);
  };
  return {
    reactions: { key, add: record("+"), remove: record("-") },
    log,
  };
}

const noFetch = (() => Promise.reject(new Error("unused"))) as typeof fetch;

Deno.test("the first review on a pull request clears a stale verdict, shows 👀, then its own verdict", async () => {
  const { reactions, log } = recorder();
  const finish = await new ReviewProgress().start(reactions, noFetch);
  assertEquals(log, ["-passed", "-minor", "-failed", "+reviewing"]);
  log.length = 0;
  await finish("passed");
  // The verdict goes up before 👀 comes down.
  assertEquals(log, ["+passed", "-reviewing"]);
});

Deno.test("reviewers in sequence keep the worst verdict, and a later one does not clear it", async () => {
  const progress = new ReviewProgress();
  const { reactions, log } = recorder();
  await (await progress.start(reactions, noFetch))("passed");
  log.length = 0;
  // The second reviewer must not wipe the first one's verdict as stale.
  const second = await progress.start(reactions, noFetch);
  assertEquals(log, ["+reviewing"]);
  await second("minor");
  assertEquals(log, ["+reviewing", "+minor", "-passed", "-reviewing"]);
  log.length = 0;
  // A clean third review cannot paper over the second one's findings.
  await (await progress.start(reactions, noFetch))("passed");
  assertEquals(log, ["+reviewing", "-reviewing"]);
});

Deno.test("👀 stays until the last reviewer in flight finishes", async () => {
  const progress = new ReviewProgress();
  const { reactions, log } = recorder();
  const first = await progress.start(reactions, noFetch);
  const second = await progress.start(reactions, noFetch);
  log.length = 0;
  await first("failed");
  assertEquals(log, ["+failed"]);
  await second("passed");
  assertEquals(log, ["+failed", "-reviewing"]);
});

Deno.test("a skipped review withdraws 👀 without claiming a verdict", async () => {
  const progress = new ReviewProgress();
  const { reactions, log } = recorder();
  await (await progress.start(reactions, noFetch))("skipped");
  assertEquals(log.slice(4), ["-reviewing"]);
  log.length = 0;
  // A verdict after a skip shows normally; nothing to take down.
  await (await progress.start(reactions, noFetch))("failed");
  assertEquals(log, ["+reviewing", "+failed", "-reviewing"]);
});

Deno.test("pull requests are tracked apart, by key", async () => {
  const progress = new ReviewProgress();
  const one = recorder("one");
  const two = recorder("two");
  await (await progress.start(one.reactions, noFetch))("failed");
  await (await progress.start(two.reactions, noFetch))("passed");
  assertEquals(one.log, [
    "-passed",
    "-minor",
    "-failed",
    "+reviewing",
    "+failed",
    "-reviewing",
  ]);
  // The second pull request starts fresh and is not held to the first's 👎.
  assertEquals(two.log, [
    "-passed",
    "-minor",
    "-failed",
    "+reviewing",
    "+passed",
    "-reviewing",
  ]);
});

/** A recorded host call. */
interface Call {
  url: string;
  method: string;
  body: string;
}

/** A fake `fetch` answering each call with `answer`, recording it. */
function hostFetch(
  answer: (url: string, method: string) => Response | Promise<Response>,
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

const githubEnv = (name: string): string | undefined =>
  ({
    GITHUB_REPOSITORY: "zuke-build/zuke",
    GITHUB_REF: "refs/pull/12/merge",
  })[name];

const GH_REACTIONS =
  "https://api.github.com/repos/zuke-build/zuke/issues/12/reactions";

Deno.test("GitHub: each signal is a reaction on the description, 🤏 shown as 😕", async () => {
  const reactions = githubHost.reactions?.("tkn", githubEnv);
  assertEquals(reactions?.key, "github:zuke-build/zuke#12");
  const { fetch, calls } = hostFetch(() =>
    new Response(JSON.stringify({ id: 5 }), { status: 201 })
  );
  for (const signal of ["reviewing", "passed", "minor", "failed"] as const) {
    assertEquals(await reactions?.add(signal, fetch), true);
  }
  assertEquals(calls.map((c) => [c.url, c.method]), [
    [GH_REACTIONS, "POST"],
    [GH_REACTIONS, "POST"],
    [GH_REACTIONS, "POST"],
    [GH_REACTIONS, "POST"],
  ]);
  assertEquals(calls.map((c) => JSON.parse(c.body).content), [
    "eyes",
    "+1",
    "confused",
    "-1",
  ]);
});

Deno.test("GitHub: a withdrawal finds the token's own reaction by posting it, then deletes that id", async () => {
  const reactions = githubHost.reactions?.("tkn", githubEnv);
  // 200: the token had already reacted; GitHub answers with that reaction.
  const { fetch, calls } = hostFetch((_url, method) =>
    method === "POST"
      ? new Response(JSON.stringify({ id: 77 }), { status: 200 })
      : new Response(null, { status: 204 })
  );
  assertEquals(await reactions?.remove("reviewing", fetch), true);
  assertEquals(calls.map((c) => [c.url, c.method]), [
    [GH_REACTIONS, "POST"],
    [`${GH_REACTIONS}/77`, "DELETE"],
  ]);
  assertEquals(JSON.parse(calls[0].body).content, "eyes");
});

Deno.test("GitHub: a refused, malformed or failed reaction call is false, never a throw", async () => {
  const reactions = githubHost.reactions?.("tkn", githubEnv);
  const refused = hostFetch(() => new Response("{}", { status: 403 }));
  assertEquals(await reactions?.add("passed", refused.fetch), false);
  assertEquals(await reactions?.remove("passed", refused.fetch), false);
  // Refused remove never reaches the DELETE.
  assertEquals(refused.calls.map((c) => c.method), ["POST", "POST"]);
  const noId = hostFetch(() => new Response("{}", { status: 201 }));
  assertEquals(await reactions?.add("passed", noId.fetch), false);
  const down = (() => Promise.reject(new Error("offline"))) as typeof fetch;
  assertEquals(await reactions?.add("passed", down), false);
  assertEquals(await reactions?.remove("passed", down), false);
  // The POST answers, the DELETE is refused or throws.
  const deleteRefused = hostFetch((_url, method) =>
    method === "POST"
      ? new Response(JSON.stringify({ id: 1 }), { status: 201 })
      : new Response("{}", { status: 404 })
  );
  assertEquals(await reactions?.remove("failed", deleteRefused.fetch), false);
  let posted = false;
  const deleteThrows =
    ((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted = true;
        return Promise.resolve(new Response(JSON.stringify({ id: 1 })));
      }
      return Promise.reject(new Error("reset"));
    }) as typeof fetch;
  assertEquals(await reactions?.remove("failed", deleteThrows), false);
  assertEquals(posted, true);
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
  for (const signal of ["reviewing", "passed", "minor", "failed"] as const) {
    assertEquals(await reactions?.add(signal, fetch), true);
  }
  assertEquals(calls.every((c) => c.url === GL_AWARDS), true);
  assertEquals(calls.map((c) => JSON.parse(c.body).name), [
    "eyes",
    "thumbsup",
    "pinching_hand",
    "thumbsdown",
  ]);
  const refused = hostFetch(() => new Response("{}", { status: 404 }));
  assertEquals(await reactions?.add("passed", refused.fetch), false);
  const down = (() => Promise.reject(new Error("offline"))) as typeof fetch;
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
