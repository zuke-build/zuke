/**
 * Unit tests for `src/check_run.ts` — posting a completed check run without
 * leaving a second one behind on a retry.
 *
 * `fetch` is injected via the settings seam, so none of this touches the
 * network.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { postCheckRun } from "../src/check_run.ts";
import { GhApiError } from "../src/api.ts";

/** A full commit SHA — the only shape the API accepts. */
const SHA = "a".repeat(40);

/** One recorded request. */
interface Call {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

/** A fake transport answering each path from a canned table. */
function fakeFetch(
  replies: Record<string, { status: number; body: unknown }>,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    const path = `${url.pathname.replace("/repos/acme/app", "")}${url.search}`;
    const method = init?.method ?? "GET";
    const raw = init?.body;
    calls.push({
      method,
      path,
      body: typeof raw === "string" ? JSON.parse(raw) : {},
    });
    const reply = replies[`${method} ${path}`] ?? { status: 200, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), { status: reply.status }),
    );
  };
  return { fetch: impl, calls };
}

/** The listing path for a name, on the canonical SHA. */
function listPath(name: string, page = 1): string {
  const query = new URLSearchParams({
    check_name: name,
    filter: "all",
    per_page: "100",
    page: String(page),
  });
  return `GET /commits/${SHA}/check-runs?${query}`;
}

/** Run `fn` with the Actions environment variables set to `values`. */
async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    saved.set(name, Deno.env.get(name));
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
  try {
    await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

/** An empty listing — the commit has no check run of that name yet. */
function noneYet(
  name: string,
): Record<string, { status: number; body: unknown }> {
  return {
    [listPath(name)]: { status: 200, body: { total_count: 0, check_runs: [] } },
  };
}

Deno.test("a commit with no check run of that name gets one created", async () => {
  const { fetch, calls } = fakeFetch({
    ...noneYet("CI / Required checks"),
    "POST /check-runs": {
      status: 201,
      body: { id: 42, html_url: "https://github.com/acme/app/runs/42" },
    },
  });
  const result = await postCheckRun((s) =>
    s.repo("acme/app").token("t")
      .name("CI / Required checks")
      .headSha(SHA)
      .conclusion("success")
      .fetch(fetch)
  );
  assertEquals(result.created, true);
  assertEquals(result.id, 42);
  assertEquals(result.url, "https://github.com/acme/app/runs/42");
  const post = calls[calls.length - 1];
  assertEquals(post.method, "POST");
  assertEquals(post.body.head_sha, SHA);
  assertEquals(post.body.name, "CI / Required checks");
  assertEquals(post.body.conclusion, "success");
});

Deno.test("an existing check run of that name is updated, not duplicated", async () => {
  // The re-drive case: a second attempt at the same post must leave the commit
  // with one check run, not two of which the newest silently wins.
  const { fetch, calls } = fakeFetch({
    [listPath("CI / Required checks")]: {
      status: 200,
      body: {
        total_count: 1,
        check_runs: [{ id: 7, name: "CI / Required checks" }],
      },
    },
    "PATCH /check-runs/7": {
      status: 200,
      body: { id: 7, html_url: "https://github.com/acme/app/runs/7" },
    },
  });
  const result = await postCheckRun((s) =>
    s.repo("acme/app").token("t")
      .name("CI / Required checks")
      .headSha(SHA)
      .conclusion("failure")
      .fetch(fetch)
  );
  assertEquals(result.created, false);
  assertEquals(result.id, 7);
  const patch = calls[calls.length - 1];
  assertEquals(patch.method, "PATCH");
  assertEquals(patch.body.conclusion, "failure");
  // head_sha is create-only: an update must not suggest a check run can move.
  assertEquals("head_sha" in patch.body, false);
  assertEquals(calls.filter((c) => c.method === "POST").length, 0);
});

Deno.test("the newest matching check run wins", async () => {
  // GitHub documents no order for the listing, and the stale one is the one a
  // previous attempt superseded — updating it would leave the visible check
  // saying whatever it said before.
  const { fetch, calls } = fakeFetch({
    [listPath("gate")]: {
      status: 200,
      body: {
        total_count: 3,
        check_runs: [
          { id: 5, name: "gate" },
          { id: 11, name: "gate" },
          { id: 9, name: "gate" },
        ],
      },
    },
    "PATCH /check-runs/11": { status: 200, body: { id: 11, html_url: "u" } },
  });
  const result = await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("success").fetch(fetch)
  );
  assertEquals(result.id, 11);
  assertEquals(calls[calls.length - 1].path, "/check-runs/11");
});

Deno.test("with an external id, only a check run carrying it is updated", async () => {
  // Two callers reporting under one required context stay distinct: a re-drive
  // of one must not overwrite the other's conclusion.
  const { fetch, calls } = fakeFetch({
    [listPath("gate")]: {
      status: 200,
      body: {
        total_count: 2,
        check_runs: [
          { id: 20, name: "gate", external_id: "run-b/gate" },
          { id: 8, name: "gate", external_id: "run-a/gate" },
        ],
      },
    },
    "PATCH /check-runs/8": { status: 200, body: { id: 8, html_url: "u" } },
  });
  const result = await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .externalId("run-a/gate").conclusion("success").fetch(fetch)
  );
  // The newer id 20 is a different caller's check run, so it is not touched.
  assertEquals(result.id, 8);
  assertEquals(calls[calls.length - 1].path, "/check-runs/8");
  assertEquals(calls[calls.length - 1].body.external_id, "run-a/gate");
});

Deno.test("an external id that matches nothing creates rather than overwrites", async () => {
  const { fetch, calls } = fakeFetch({
    [listPath("gate")]: {
      status: 200,
      body: {
        total_count: 1,
        check_runs: [{ id: 20, name: "gate", external_id: "someone-else" }],
      },
    },
    "POST /check-runs": { status: 201, body: { id: 21, html_url: "u" } },
  });
  const result = await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .externalId("mine").conclusion("success").fetch(fetch)
  );
  assertEquals(result.created, true);
  assertEquals(calls.filter((c) => c.method === "PATCH").length, 0);
});

Deno.test("the listing is paginated to the last candidate", async () => {
  // A missed candidate is a duplicate check run — the one failure this whole
  // lookup exists to prevent — so the first page is not taken on trust.
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    name: "gate",
  }));
  const { fetch, calls } = fakeFetch({
    [listPath("gate", 1)]: {
      status: 200,
      body: { total_count: 101, check_runs: page1 },
    },
    [listPath("gate", 2)]: {
      status: 200,
      body: { total_count: 101, check_runs: [{ id: 900, name: "gate" }] },
    },
    "PATCH /check-runs/900": { status: 200, body: { id: 900, html_url: "u" } },
  });
  const result = await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("success").fetch(fetch)
  );
  assertEquals(result.id, 900);
  assertEquals(calls.filter((c) => c.method === "GET").length, 2);
});

Deno.test("a listing that stops short of its own total does not loop", async () => {
  // A total_count that overstates the pages must not spin: an empty page ends
  // the walk with whatever was found.
  const { fetch, calls } = fakeFetch({
    [listPath("gate", 1)]: {
      status: 200,
      body: { total_count: 999, check_runs: [{ id: 3, name: "gate" }] },
    },
    [listPath("gate", 2)]: {
      status: 200,
      body: { total_count: 999, check_runs: [] },
    },
    "PATCH /check-runs/3": { status: 200, body: { id: 3, html_url: "u" } },
  });
  const result = await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("success").fetch(fetch)
  );
  assertEquals(result.id, 3);
  assertEquals(calls.filter((c) => c.method === "GET").length, 2);
});

Deno.test("naming either half of the output panel fills in the other", async () => {
  // GitHub rejects an output panel with a title and no summary, or the reverse.
  const { fetch, calls } = fakeFetch({
    ...noneYet("gate"),
    "POST /check-runs": { status: 201, body: { id: 1, html_url: "u" } },
  });
  await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("success").summary("11 of 12 checks passed").fetch(fetch)
  );
  assertEquals(calls[calls.length - 1].body.output, {
    title: "gate",
    summary: "11 of 12 checks passed",
  });

  const second = fakeFetch({
    ...noneYet("gate"),
    "POST /check-runs": { status: 201, body: { id: 2, html_url: "u" } },
  });
  await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("success").title("Required checks").fetch(second.fetch)
  );
  assertEquals(second.calls[second.calls.length - 1].body.output, {
    title: "Required checks",
    summary: "",
  });
});

Deno.test("no output panel is sent when neither half is named", async () => {
  const { fetch, calls } = fakeFetch({
    ...noneYet("gate"),
    "POST /check-runs": { status: 201, body: { id: 1, html_url: "u" } },
  });
  await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("success").detailsUrl("https://ci.example/run/1").fetch(fetch)
  );
  const post = calls[calls.length - 1];
  assertEquals("output" in post.body, false);
  assertEquals(post.body.details_url, "https://ci.example/run/1");
});

Deno.test("the required settings are named individually when missing", async () => {
  const { fetch } = fakeFetch({});
  await assertRejects(
    () => postCheckRun((s) => s.repo("acme/app").token("t").fetch(fetch)),
    Error,
    ".name(...)",
  );
  await assertRejects(
    () =>
      postCheckRun((s) =>
        s.repo("acme/app").token("t").name("gate").fetch(fetch)
      ),
    Error,
    ".headSha(...)",
  );
  await assertRejects(
    () =>
      postCheckRun((s) =>
        s.repo("acme/app").token("t").name("gate").headSha(SHA).fetch(fetch)
      ),
    Error,
    ".conclusion(...)",
  );
});

Deno.test("a branch name or an abbreviated SHA is refused before the call", async () => {
  const { fetch, calls } = fakeFetch({});
  for (const bad of ["master", "a1b2c3d", `${SHA}/../../x`]) {
    const error = await assertRejects(
      () =>
        postCheckRun((s) =>
          s.repo("acme/app").token("t").name("gate").headSha(bad)
            .conclusion("success").fetch(fetch)
        ),
      Error,
      "head SHA",
    );
    assertStringIncludes(error.message, "40- or 64-character");
  }
  // Nothing was sent: the guard runs before the transport is built.
  assertEquals(calls.length, 0);
});

Deno.test("the listing asks for every check run, not just the latest per name", async () => {
  // GitHub's default is filter=latest, which returns at most one run per name.
  // On a commit that already carries two, the one being looked for may not be
  // in the response at all — and this would create a third.
  const { fetch, calls } = fakeFetch({
    ...noneYet("gate"),
    "POST /check-runs": { status: 201, body: { id: 1, html_url: "u" } },
  });
  await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("success").fetch(fetch)
  );
  assertStringIncludes(calls[0].path, "filter=all");
});

Deno.test("a check run owned by another app is not updated but replaced", async () => {
  // A check run may only be updated by the app that created it. During a
  // migration the same name is often still produced by the workflow being
  // replaced, owned by a different app — and a refusal that propagated would
  // repeat on every re-drive, leaving a required context never posted at all.
  const { fetch, calls } = fakeFetch({
    [listPath("CI / Required checks")]: {
      status: 200,
      body: {
        total_count: 1,
        check_runs: [{ id: 99, name: "CI / Required checks" }],
      },
    },
    "PATCH /check-runs/99": {
      status: 403,
      body: { message: "Resource not accessible by integration" },
    },
    "POST /check-runs": { status: 201, body: { id: 100, html_url: "u" } },
  });
  const result = await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("CI / Required checks").headSha(SHA)
      .conclusion("failure").fetch(fetch)
  );
  assertEquals(result.created, true);
  assertEquals(result.id, 100);
  assertEquals(calls.map((c) => c.method), ["GET", "PATCH", "POST"]);
});

Deno.test("a refused create is not masked by the update fallback", async () => {
  // The fallback must not turn a token that genuinely lacks checks:write into
  // silence: the create is refused too, and that error is the one to report.
  const { fetch } = fakeFetch({
    [listPath("gate")]: {
      status: 200,
      body: { total_count: 1, check_runs: [{ id: 99, name: "gate" }] },
    },
    "PATCH /check-runs/99": { status: 403, body: { message: "nope" } },
    "POST /check-runs": { status: 403, body: { message: "still nope" } },
  });
  const error = await assertRejects(
    () =>
      postCheckRun((s) =>
        s.repo("acme/app").token("t").name("gate").headSha(SHA)
          .conclusion("success").fetch(fetch)
      ),
    GhApiError,
  );
  assertStringIncludes(error.message, "still nope");
});

Deno.test("an update failure that is not a refusal propagates", async () => {
  // A 500 says nothing about ownership. Creating a second check run because
  // the server had a bad minute is the duplicate this function exists to avoid.
  const { fetch, calls } = fakeFetch({
    [listPath("gate")]: {
      status: 200,
      body: { total_count: 1, check_runs: [{ id: 99, name: "gate" }] },
    },
    "PATCH /check-runs/99": { status: 500, body: { message: "server error" } },
  });
  await assertRejects(
    () =>
      postCheckRun((s) =>
        s.repo("acme/app").token("t").name("gate").headSha(SHA)
          .conclusion("success").fetch(fetch)
      ),
    GhApiError,
  );
  assertEquals(calls.filter((c) => c.method === "POST").length, 0);
});

Deno.test("an update rewrites the output panel rather than leaving a stale one", async () => {
  // A partial update would leave the previous attempt's text under this
  // attempt's conclusion — "12 of 12 checks passed" above a failure.
  const { fetch, calls } = fakeFetch({
    [listPath("gate")]: {
      status: 200,
      body: { total_count: 1, check_runs: [{ id: 7, name: "gate" }] },
    },
    "PATCH /check-runs/7": { status: 200, body: { id: 7, html_url: "u" } },
  });
  await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("failure").fetch(fetch)
  );
  assertEquals(calls[calls.length - 1].body.output, {
    title: "gate",
    summary: "",
  });
});

Deno.test("a caller with no external id does not adopt one that has it", async () => {
  // The isolation has to hold from both sides, or the setting only protects
  // the caller that remembered to set it.
  const { fetch, calls } = fakeFetch({
    [listPath("gate")]: {
      status: 200,
      body: {
        total_count: 1,
        check_runs: [{ id: 20, name: "gate", external_id: "someone-else" }],
      },
    },
    "POST /check-runs": { status: 201, body: { id: 21, html_url: "u" } },
  });
  const result = await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("success").fetch(fetch)
  );
  assertEquals(result.created, true);
  assertEquals(calls.filter((c) => c.method === "PATCH").length, 0);
});

Deno.test("the repo and token fall back to the Actions environment", async () => {
  const { fetch, calls } = fakeFetch({
    ...noneYet("gate"),
    "POST /check-runs": { status: 201, body: { id: 1, html_url: "u" } },
  });
  await withEnv(
    { GITHUB_REPOSITORY: "acme/app", GITHUB_TOKEN: "ghs_env" },
    async () => {
      const result = await postCheckRun((s) =>
        s.name("gate").headSha(SHA).conclusion("success").fetch(fetch)
      );
      assertEquals(result.created, true);
    },
  );
  // The path was built from the environment's slug — fakeFetch strips it.
  assertEquals(calls[0].path.startsWith("/commits/"), true);
});

Deno.test("a missing repo or token says which setting to reach for", async () => {
  const { fetch } = fakeFetch({});
  await withEnv({ GITHUB_REPOSITORY: undefined }, async () => {
    const error = await assertRejects(
      () =>
        postCheckRun((s) =>
          s.name("gate").headSha(SHA).conclusion("success").token("t")
            .fetch(fetch)
        ),
      Error,
      ".repo('owner/name')",
    );
    assertStringIncludes(error.message, "GITHUB_REPOSITORY");
  });
  await withEnv({ GITHUB_TOKEN: undefined }, async () => {
    const error = await assertRejects(
      () =>
        postCheckRun((s) =>
          s.repo("acme/app").name("gate").headSha(SHA).conclusion("success")
            .fetch(fetch)
        ),
      Error,
      ".token(...)",
    );
    // The message names the one permission the token needs, so nobody reaches
    // for a broader one to make the error go away.
    assertStringIncludes(error.message, "`checks: write`");
  });
});

Deno.test("a GitHub Enterprise base URL is used, trailing slashes and all", async () => {
  const calls: string[] = [];
  const impl: typeof fetch = (input) => {
    calls.push(String(input));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          total_count: 0,
          check_runs: [],
          id: 1,
          html_url: "u",
        }),
        { status: 200 },
      ),
    );
  };
  await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("success").baseUrl("https://ghe.example/api/v3//").fetch(impl)
  );
  assertEquals(
    calls[0].startsWith("https://ghe.example/api/v3/repos/acme/app/"),
    true,
  );
});

Deno.test("a listing of junk is treated as no match, not as a candidate", async () => {
  // Every field of the response is checked rather than trusted: a malformed
  // entry that slipped through as a match would send the update to whatever id
  // happened to parse.
  const { fetch, calls } = fakeFetch({
    [listPath("gate")]: {
      status: 200,
      body: {
        total_count: 4,
        check_runs: [
          null,
          "not a record",
          { id: 3, name: "some other check" },
          { id: "not a number", name: "gate" },
        ],
      },
    },
    "POST /check-runs": { status: 201, body: { id: 50, html_url: "u" } },
  });
  const result = await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("success").fetch(fetch)
  );
  assertEquals(result.created, true);
  assertEquals(calls.filter((c) => c.method === "PATCH").length, 0);
});

Deno.test("a listing that is not an object at all creates rather than guessing", async () => {
  const { fetch } = fakeFetch({
    [listPath("gate")]: { status: 200, body: "gateway said hello" },
    "POST /check-runs": { status: 201, body: { id: 60, html_url: "u" } },
  });
  const result = await postCheckRun((s) =>
    s.repo("acme/app").token("t").name("gate").headSha(SHA)
      .conclusion("success").fetch(fetch)
  );
  assertEquals(result.created, true);
});

Deno.test("a refused write surfaces as a GhApiError carrying the status", async () => {
  const { fetch } = fakeFetch({
    ...noneYet("gate"),
    "POST /check-runs": {
      status: 403,
      body: { message: "Resource not accessible by integration" },
    },
  });
  const error = await assertRejects(
    () =>
      postCheckRun((s) =>
        s.repo("acme/app").token("s3cr3t-token").name("gate").headSha(SHA)
          .conclusion("success").fetch(fetch)
      ),
    GhApiError,
  );
  if (!(error instanceof GhApiError)) throw new Error("expected a GhApiError");
  assertEquals(error.status, 403);
  assertStringIncludes(error.message, "not accessible by integration");
  // The token lives in a request header and never in a message.
  assertEquals(error.message.includes("s3cr3t-token"), false);
});
