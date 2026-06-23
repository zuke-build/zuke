import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { AiReviewError } from "../mod.ts";
import { detectReviewHost, hostFor } from "../src/hosts.ts";
import {
  type GithubContext,
  resolveGithubContext,
  upsertPrComment,
} from "../src/hosts/github.ts";
import {
  type GitlabContext,
  resolveGitlabContext,
  upsertMergeRequestNote,
} from "../src/hosts/gitlab.ts";
import {
  type AzureContext,
  resolveAzureContext,
  upsertPullRequestThread,
} from "../src/hosts/azure.ts";
import {
  type BitbucketContext,
  resolveBitbucketContext,
  upsertBitbucketComment,
} from "../src/hosts/bitbucket.ts";

/** A recorded request. */
interface Call {
  url: string;
  method: string;
  body: string;
}

/**
 * A fake `fetch` for the GitHub API: the GET (list comments) returns `comments`,
 * any write returns `{}`. Both use `status`. Records every call.
 */
function fakeGithub(
  comments: unknown,
  status = 200,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(input),
      method,
      body: typeof init?.body === "string" ? init.body : "",
    });
    const payload = method === "GET" ? JSON.stringify(comments) : "{}";
    return Promise.resolve(new Response(payload, { status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/** A reader over a fixed env map. */
function env(map: Record<string, string>): (key: string) => string | undefined {
  return (key) => map[key];
}

const VALID = {
  GITHUB_REPOSITORY: "zuke-build/zuke",
  GITHUB_REF: "refs/pull/100/merge",
};

const CONTEXT: GithubContext = {
  token: "tkn",
  owner: "zuke-build",
  repo: "zuke",
  pull: 100,
};

Deno.test("resolveGithubContext reads owner/repo and the PR number", () => {
  assertEquals(resolveGithubContext("tkn", env(VALID)), CONTEXT);
});

Deno.test("resolveGithubContext returns undefined when anything is missing", () => {
  // No token.
  assertEquals(resolveGithubContext("", env(VALID)), undefined);
  // No GITHUB_REPOSITORY.
  assertEquals(
    resolveGithubContext("tkn", env({ GITHUB_REF: VALID.GITHUB_REF })),
    undefined,
  );
  // Malformed repository slugs.
  for (const repo of ["noslash", "/repo", "owner/"]) {
    assertEquals(
      resolveGithubContext(
        "tkn",
        env({ GITHUB_REPOSITORY: repo, GITHUB_REF: VALID.GITHUB_REF }),
      ),
      undefined,
    );
  }
  // A non-PR ref (e.g. a branch push) has no pull number.
  assertEquals(
    resolveGithubContext(
      "tkn",
      env({ ...VALID, GITHUB_REF: "refs/heads/master" }),
    ),
    undefined,
  );
});

Deno.test("upsertPrComment creates a new comment when none exists", async () => {
  const { fetch, calls } = fakeGithub([]);
  await upsertPrComment(CONTEXT, "security review", "## body", fetch);

  assertEquals(calls.length, 2); // list, then create
  assertEquals(
    calls[0].url,
    "https://api.github.com/repos/zuke-build/zuke/issues/100/comments?per_page=100",
  );
  assertEquals(calls[1].method, "POST");
  assertEquals(
    calls[1].url,
    "https://api.github.com/repos/zuke-build/zuke/issues/100/comments",
  );
  const body = JSON.parse(calls[1].body);
  assertEquals(
    body.body.includes("<!-- zuke-ai-review:security review -->"),
    true,
  );
  // The comment is attributed to Zuke.
  assertEquals(
    body.body.includes("🤖 **[Zuke](https://zuke.build) AI review**"),
    true,
  );
  assertEquals(body.body.includes("## body"), true);
});

Deno.test("upsertPrComment patches the existing comment in place", async () => {
  const existing = [
    { id: 1, body: "unrelated" },
    { id: 7, body: "<!-- zuke-ai-review:security review -->\nold" },
  ];
  const { fetch, calls } = fakeGithub(existing);
  await upsertPrComment(CONTEXT, "security review", "## new", fetch);

  assertEquals(calls[1].method, "PATCH");
  assertEquals(
    calls[1].url,
    "https://api.github.com/repos/zuke-build/zuke/issues/comments/7",
  );
});

Deno.test("upsertPrComment ignores a non-array comment listing", async () => {
  const { fetch, calls } = fakeGithub({ message: "Not Found" });
  await upsertPrComment(CONTEXT, "security review", "## body", fetch);
  assertEquals(calls[1].method, "POST"); // falls back to creating
});

Deno.test("upsertPrComment surfaces a GitHub API error", async () => {
  const { fetch } = fakeGithub([], 403);
  await assertRejects(
    () => upsertPrComment(CONTEXT, "security review", "## body", fetch),
    AiReviewError,
    "GitHub API error: HTTP 403",
  );
});

// ─── Dispatch ────────────────────────────────────────────────────────────────

Deno.test("detectReviewHost picks the host matching the active CI env", () => {
  const cases: Array<[Record<string, string>, string | undefined]> = [
    [{ GITHUB_ACTIONS: "true" }, "GitHub"],
    [{ GITLAB_CI: "true" }, "GitLab"],
    [{ TF_BUILD: "True" }, "Azure Pipelines"],
    [{ BITBUCKET_BUILD_NUMBER: "1" }, "Bitbucket"],
    [{}, undefined],
  ];
  for (const [env, label] of cases) {
    const host = detectReviewHost((k) => env[k]);
    assertEquals(host?.label, label);
  }
});

Deno.test("each host advertises a default token env var", () => {
  assertEquals(hostFor("github")?.defaultTokenEnv, "GITHUB_TOKEN");
  assertEquals(hostFor("gitlab")?.defaultTokenEnv, "GITLAB_TOKEN");
  assertEquals(hostFor("azure")?.defaultTokenEnv, "SYSTEM_ACCESSTOKEN");
  assertEquals(hostFor("bitbucket")?.defaultTokenEnv, "BITBUCKET_TOKEN");
});

// ─── GitLab ─────────────────────────────────────────────────────────────────

const GITLAB_ENV = {
  CI_PROJECT_ID: "42",
  CI_MERGE_REQUEST_IID: "7",
  CI_API_V4_URL: "https://gitlab.example/api/v4",
};

const GITLAB_CTX: GitlabContext = {
  token: "glat",
  api: "https://gitlab.example/api/v4",
  projectId: "42",
  mrIid: "7",
};

/** A fake GitLab API: GET returns `notes`, POST/PUT return `{}` at `status`. */
function fakeGitlab(
  notes: unknown,
  status = 200,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(input),
      method,
      body: typeof init?.body === "string" ? init.body : "",
    });
    const payload = method === "GET" ? JSON.stringify(notes) : "{}";
    return Promise.resolve(new Response(payload, { status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

Deno.test("resolveGitlabContext requires project id and MR iid", () => {
  assertEquals(resolveGitlabContext("glat", env(GITLAB_ENV)), GITLAB_CTX);
  assertEquals(resolveGitlabContext("", env(GITLAB_ENV)), undefined);
  // Without the MR iid → not in a merge-request pipeline.
  assertEquals(
    resolveGitlabContext("glat", env({ CI_PROJECT_ID: "42" })),
    undefined,
  );
  // Without CI_API_V4_URL, the default gitlab.com root is used.
  assertEquals(
    resolveGitlabContext(
      "glat",
      env({ CI_PROJECT_ID: "42", CI_MERGE_REQUEST_IID: "7" }),
    )?.api,
    "https://gitlab.com/api/v4",
  );
});

Deno.test("upsertMergeRequestNote creates with POST when no prior note exists", async () => {
  const { fetch, calls } = fakeGitlab([]);
  await upsertMergeRequestNote(GITLAB_CTX, "security review", "## body", fetch);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].method, "GET");
  assertEquals(
    calls[0].url,
    "https://gitlab.example/api/v4/projects/42/merge_requests/7/notes?per_page=100&sort=desc",
  );
  assertEquals(calls[1].method, "POST");
  assertEquals(
    calls[1].url,
    "https://gitlab.example/api/v4/projects/42/merge_requests/7/notes",
  );
  // The body carries the marker and Zuke header — that's the round-trip we care about.
  const body = JSON.parse(calls[1].body);
  assertEquals(
    body.body.includes("<!-- zuke-ai-review:security review -->"),
    true,
  );
  assertEquals(
    body.body.includes("🤖 **[Zuke](https://zuke.build) AI review**"),
    true,
  );
});

Deno.test("upsertMergeRequestNote PUTs an existing note in place", async () => {
  const existing = [
    { id: 11, body: "unrelated" },
    { id: 22, body: "<!-- zuke-ai-review:security review -->\nold" },
  ];
  const { fetch, calls } = fakeGitlab(existing);
  await upsertMergeRequestNote(GITLAB_CTX, "security review", "## new", fetch);
  assertEquals(calls[1].method, "PUT");
  assertEquals(
    calls[1].url,
    "https://gitlab.example/api/v4/projects/42/merge_requests/7/notes/22",
  );
});

Deno.test("upsertMergeRequestNote surfaces a non-2xx response as AiReviewError", async () => {
  const { fetch } = fakeGitlab([], 401);
  await assertRejects(
    () =>
      upsertMergeRequestNote(GITLAB_CTX, "security review", "## body", fetch),
    AiReviewError,
    "GitLab API error: HTTP 401",
  );
});

// ─── Azure Pipelines ─────────────────────────────────────────────────────────

const AZURE_ENV = {
  SYSTEM_COLLECTIONURI: "https://dev.azure.com/myorg/",
  SYSTEM_TEAMPROJECT: "MyProject",
  BUILD_REPOSITORY_ID: "repo-uuid",
  SYSTEM_PULLREQUEST_PULLREQUESTID: "99",
};

const AZURE_CTX: AzureContext = {
  token: "azt",
  collection: "https://dev.azure.com/myorg/",
  project: "MyProject",
  repositoryId: "repo-uuid",
  pullRequestId: "99",
};

/** A fake Azure REST: GET returns a `value: [...]` threads list, writes return `{}`. */
function fakeAzure(
  threads: unknown[],
  status = 200,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(input),
      method,
      body: typeof init?.body === "string" ? init.body : "",
    });
    const payload = method === "GET"
      ? JSON.stringify({ value: threads })
      : "{}";
    return Promise.resolve(new Response(payload, { status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

Deno.test("resolveAzureContext requires every Azure variable + a token", () => {
  assertEquals(resolveAzureContext("azt", env(AZURE_ENV)), AZURE_CTX);
  assertEquals(resolveAzureContext("", env(AZURE_ENV)), undefined);
  // Collection alone isn't enough — every Azure variable must be present.
  assertEquals(
    resolveAzureContext(
      "azt",
      env({ SYSTEM_COLLECTIONURI: "https://dev.azure.com/myorg/" }),
    ),
    undefined,
  );
});

Deno.test("upsertPullRequestThread POSTs a new thread when no prior one exists", async () => {
  const { fetch, calls } = fakeAzure([]);
  await upsertPullRequestThread(AZURE_CTX, "security review", "## body", fetch);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].method, "GET");
  // GET list and POST root use the same threads URL.
  assertEquals(
    calls[1].url,
    "https://dev.azure.com/myorg/MyProject/_apis/git/repositories/repo-uuid/pullRequests/99/threads?api-version=7.1",
  );
  assertEquals(calls[1].method, "POST");
  const body = JSON.parse(calls[1].body);
  assertEquals(
    body.comments[0].content.includes(
      "<!-- zuke-ai-review:security review -->",
    ),
    true,
  );
  assertEquals(body.status, 4); // closed — informational thread
});

Deno.test("upsertPullRequestThread PATCHes the marker-bearing comment in an existing thread", async () => {
  const threads = [{
    id: 7,
    comments: [
      { id: 1, content: "<!-- zuke-ai-review:security review -->\nold" },
    ],
  }];
  const { fetch, calls } = fakeAzure(threads);
  await upsertPullRequestThread(AZURE_CTX, "security review", "## new", fetch);
  assertEquals(calls[1].method, "PATCH");
  assertEquals(
    calls[1].url,
    "https://dev.azure.com/myorg/MyProject/_apis/git/repositories/repo-uuid/pullRequests/99/threads/7/comments/1?api-version=7.1",
  );
});

Deno.test("upsertPullRequestThread surfaces a non-2xx Azure response", async () => {
  const { fetch } = fakeAzure([], 500);
  await assertRejects(
    () =>
      upsertPullRequestThread(AZURE_CTX, "security review", "## body", fetch),
    AiReviewError,
    "Azure DevOps API error: HTTP 500",
  );
});

// ─── Bitbucket Cloud ────────────────────────────────────────────────────────

const BITBUCKET_ENV = {
  BITBUCKET_WORKSPACE: "ws",
  BITBUCKET_REPO_SLUG: "repo",
  BITBUCKET_PR_ID: "5",
};

const BITBUCKET_CTX: BitbucketContext = {
  token: "bbt",
  workspace: "ws",
  repoSlug: "repo",
  prId: "5",
};

/** A fake Bitbucket REST: GET returns `values: [...]`, writes return `{}`. */
function fakeBitbucket(
  values: unknown[],
  status = 200,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(input),
      method,
      body: typeof init?.body === "string" ? init.body : "",
    });
    const payload = method === "GET" ? JSON.stringify({ values }) : "{}";
    return Promise.resolve(new Response(payload, { status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

Deno.test("resolveBitbucketContext requires workspace + slug + PR id + token", () => {
  assertEquals(
    resolveBitbucketContext("bbt", env(BITBUCKET_ENV)),
    BITBUCKET_CTX,
  );
  assertEquals(resolveBitbucketContext("", env(BITBUCKET_ENV)), undefined);
  // Workspace alone isn't enough — slug and PR id must also be present.
  assertEquals(
    resolveBitbucketContext("bbt", env({ BITBUCKET_WORKSPACE: "ws" })),
    undefined,
  );
});

Deno.test("upsertBitbucketComment POSTs a new comment with content.raw", async () => {
  const { fetch, calls } = fakeBitbucket([]);
  await upsertBitbucketComment(
    BITBUCKET_CTX,
    "security review",
    "## body",
    fetch,
  );
  assertEquals(calls.length, 2);
  assertEquals(calls[1].method, "POST");
  assertEquals(
    calls[1].url,
    "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests/5/comments",
  );
  const body = JSON.parse(calls[1].body);
  assertEquals(
    body.content.raw.includes("<!-- zuke-ai-review:security review -->"),
    true,
  );
});

Deno.test("upsertBitbucketComment PUTs an existing comment matched by marker", async () => {
  const existing = [
    { id: 17, content: { raw: "unrelated" } },
    {
      id: 18,
      content: { raw: "<!-- zuke-ai-review:security review -->\nold" },
    },
  ];
  const { fetch, calls } = fakeBitbucket(existing);
  await upsertBitbucketComment(
    BITBUCKET_CTX,
    "security review",
    "## new",
    fetch,
  );
  assertEquals(calls[1].method, "PUT");
  assertEquals(
    calls[1].url,
    "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests/5/comments/18",
  );
});

Deno.test("upsertBitbucketComment surfaces a non-2xx Bitbucket response", async () => {
  const { fetch } = fakeBitbucket([], 403);
  await assertRejects(
    () =>
      upsertBitbucketComment(
        BITBUCKET_CTX,
        "security review",
        "## body",
        fetch,
      ),
    AiReviewError,
    "Bitbucket API error: HTTP 403",
  );
});
