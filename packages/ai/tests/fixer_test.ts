import { assertEquals } from "../../core/tests/_assert.ts";
import { CommandError } from "@zuke/core/shell";
import { AiFixer, aiFixer, type Fix } from "../mod.ts";
import { checkEdits, DEFAULT_FIX_EXCLUDES } from "../src/apply.ts";
import { parseFix } from "../src/fix.ts";
import { readTextOrUndefined } from "../src/fixer.ts";
import { commitAndPush } from "../src/commit.ts";
import { fixMarkdown } from "../src/fix_report.ts";
import type { RemediationContext } from "@zuke/core";

/** A recorded fetch call. */
interface Call {
  url: string;
  body: string;
}

/** A fake `fetch` returning a fixed body/status, recording each call. */
function recordFetch(
  body: string,
  status = 200,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/** Wrap a fix in a Claude Messages-API response. */
function claudeFix(fix: Partial<Fix>): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(fix) }],
    stop_reason: "end_turn",
  });
}

/** A captured write (path → content). */
interface Write {
  path: string;
  content: string;
}

/** Seams that make a fixer fully hermetic, plus their recorders. */
function seams() {
  const writes: Write[] = [];
  const git: string[][] = [];
  return {
    writes,
    git,
    apply(f: AiFixer): AiFixer {
      return f
        .conventions("")
        .diff((d) => d.text(""))
        .exec((argv) => {
          git.push(argv);
          return Promise.resolve("");
        })
        .write((path, content) => {
          writes.push({ path, content });
          return Promise.resolve();
        })
        .env(() => undefined);
    },
  };
}

const CTX: RemediationContext = {
  target: "test",
  attempt: 1,
  error: new Error("boom: a test failed"),
};

const ONE_EDIT: Partial<Fix> = {
  diagnosis: "off-by-one in loop",
  rootCause: "wrong bound",
  confidence: "high",
  edits: [{ path: "src/app.ts", content: "export const x = 1;\n" }],
};

Deno.test("default diagnoses without writing or asking to retry", async () => {
  const s = seams();
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s.apply(aiFixer((f) => f.provider("claude").apiKey("k")))
    .fetch(fetch).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
  assertEquals(s.writes.length, 0);
  assertEquals(s.git.length, 0);
  // The fix schema and the error output reach the provider.
  assertEquals(calls[0].url.includes("anthropic.com"), true);
  assertEquals(calls[0].body.includes("boom: a test failed"), true);
});

Deno.test("autoApply writes the fix and asks the executor to retry", async () => {
  const s = seams();
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s.apply(
    aiFixer((f) => f.provider("claude").apiKey("k").autoApply()),
  ).fetch(fetch).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, true);
  assertEquals(s.writes, [{
    path: "src/app.ts",
    content: "export const x = 1;\n",
  }]);
});

Deno.test("autoApply is blocked on CI unless allowCI is set", async () => {
  const s = seams();
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const ciEnv = (name: string) =>
    name === "GITHUB_ACTIONS" ? "true" : undefined;
  const fixer = aiFixer((f) =>
    f.provider("claude").apiKey("k").autoApply()
      .conventions("").diff((d) => d.text("")).env(ciEnv)
      .write((p, c) => {
        s.writes.push({ path: p, content: c });
        return Promise.resolve();
      })
  ).fetch(fetch).quiet();
  const blocked = await fixer.remediate(CTX);
  assertEquals(blocked.retry, false);
  assertEquals(s.writes.length, 0);

  // With allowCI, the same fixer applies on CI.
  const applied = await fixer.allowCI().remediate(CTX);
  assertEquals(applied.retry, true);
  assertEquals(s.writes.length, 1);
});

Deno.test("an edit outside the allowlist is refused, nothing is written", async () => {
  const s = seams();
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s.apply(
    aiFixer((f) =>
      f.provider("claude").apiKey("k").autoApply().allowPaths("packages/**")
    ),
  ).fetch(fetch).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
  assertEquals(s.writes.length, 0);
});

Deno.test("commitFixes stages, commits, and pushes the applied files", async () => {
  const s = seams();
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s.apply(
    aiFixer((f) => f.provider("claude").apiKey("k").commitFixes()),
  ).fetch(fetch).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, true);
  assertEquals(s.git, [
    ["git", "add", "--", "src/app.ts"],
    ["git", "commit", "-m", 'Apply Zuke AI fix for "test"'],
    ["git", "push"],
  ]);
});

Deno.test("noPush commits without pushing", async () => {
  const s = seams();
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s.apply(
    aiFixer((f) =>
      f.provider("claude").apiKey("k").commitFixes().noPush()
        .commitMessage("fix: heal build")
    ),
  ).fetch(fetch).quiet();
  await fixer.remediate(CTX);
  assertEquals(s.git, [
    ["git", "add", "--", "src/app.ts"],
    ["git", "commit", "-m", "fix: heal build"],
  ]);
});

Deno.test("a failed push is reported but the fix still retries", async () => {
  const s = seams();
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k").commitFixes())
    .conventions("").diff((d) => d.text("")).env(() => undefined)
    .write((p, c) => {
      s.writes.push({ path: p, content: c });
      return Promise.resolve();
    })
    .exec((argv) => {
      if (argv[1] === "push") return Promise.reject(new Error("no upstream"));
      return Promise.resolve("");
    })
    .fetch(fetch).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, true);
  assertEquals(s.writes.length, 1);
});

Deno.test("a missing API key skips with no provider call", async () => {
  const s = seams();
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s.apply(aiFixer((f) => f.provider("claude"))).fetch(fetch)
    .quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
  assertEquals(calls.length, 0);
});

Deno.test("a missing provider skips", async () => {
  const result = await new AiFixer().remediate(CTX);
  assertEquals(result.retry, false);
});

Deno.test("a provider error is swallowed (never masks the build failure)", async () => {
  const s = seams();
  const { fetch } = recordFetch("bad request", 400);
  const fixer = s.apply(
    aiFixer((f) => f.provider("claude").apiKey("k").retry({ attempts: 1 })),
  ).fetch(fetch).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
});

Deno.test("invalid JSON from the model is handled gracefully", async () => {
  const s = seams();
  const { fetch } = recordFetch(
    JSON.stringify({
      content: [{ type: "text", text: "not json" }],
      stop_reason: "end_turn",
    }),
  );
  const fixer = s.apply(aiFixer((f) => f.provider("claude").apiKey("k")))
    .fetch(fetch).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
});

Deno.test("a fix with no edits is diagnosed, not applied", async () => {
  const s = seams();
  const { fetch } = recordFetch(claudeFix({ ...ONE_EDIT, edits: [] }));
  const fixer = s.apply(
    aiFixer((f) => f.provider("claude").apiKey("k").autoApply()),
  ).fetch(fetch).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
  assertEquals(s.writes.length, 0);
});

Deno.test("CommandError context feeds the failed command and stderr to the prompt", async () => {
  const s = seams();
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s.apply(aiFixer((f) => f.provider("claude").apiKey("k")))
    .fetch(fetch).quiet();
  await fixer.remediate({
    target: "lint",
    attempt: 1,
    error: new CommandError("deno lint", 1, "error: unused variable x"),
  });
  assertEquals(calls[0].body.includes("deno lint"), true);
  assertEquals(calls[0].body.includes("unused variable x"), true);
});

Deno.test("conventions and the context diff reach the prompt", async () => {
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("Never use any.")
    .diff((d) => d.text("diff --git a/x b/x"))
    .env(() => undefined)
    .fetch(fetch).quiet();
  await fixer.remediate(CTX);
  assertEquals(calls[0].body.includes("Never use any."), true);
  assertEquals(calls[0].body.includes("diff --git a/x b/x"), true);
});

Deno.test("conventions are read from CLAUDE.md/AGENTS.md via the file seam", async () => {
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .diff((d) => d.text("")).env(() => undefined)
    .readFile((path) =>
      Promise.resolve(path === "AGENTS.md" ? "Agent rules here" : undefined)
    )
    .fetch(fetch).quiet();
  await fixer.remediate(CTX);
  assertEquals(calls[0].body.includes("Agent rules here"), true);
});

Deno.test("checkEdits enforces the allowlist, exclusions, traversal, and the cap", () => {
  const guards = { allow: ["src/**"], exclude: [], maxEdits: 2 };
  assertEquals(
    checkEdits([{ path: "./src/a.ts", content: "" }], guards),
    ["src/a.ts"],
  );
  // Excluded by the built-ins regardless of the allowlist.
  let threw = false;
  try {
    checkEdits([{ path: "deno.lock", content: "" }], {
      allow: ["**"],
      exclude: [],
      maxEdits: 5,
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  // Outside the allowlist.
  threw = false;
  try {
    checkEdits([{ path: "secret.txt", content: "" }], guards);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  // Path traversal — POSIX, Windows backslashes, and drive/UNC absolutes.
  for (
    const hostile of [
      "../etc/passwd",
      "..\\..\\evil.ts",
      "src\\..\\..\\evil.ts",
      "C:\\Windows\\system32",
      "\\\\server\\share\\x",
    ]
  ) {
    let rejected = false;
    try {
      checkEdits([{ path: hostile, content: "" }], {
        allow: ["**"],
        exclude: [],
        maxEdits: 5,
      });
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
  }
  // Over the file cap.
  threw = false;
  try {
    checkEdits(
      [{ path: "src/a.ts", content: "" }, { path: "src/b.ts", content: "" }, {
        path: "src/c.ts",
        content: "",
      }],
      guards,
    );
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  // The built-in exclusion list is non-empty (workflows, lockfiles, keys).
  assertEquals(DEFAULT_FIX_EXCLUDES.length > 0, true);
});

/** A Claude fix response carrying token usage. */
function claudeFixUsage(
  fix: Partial<Fix>,
  usage: Record<string, number>,
): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(fix) }],
    stop_reason: "end_turn",
    usage,
  });
}

/** A fetch that routes GitHub calls to the comment API and the rest to `body`. */
function routedFetch(body: string): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    if (url.includes("api.github.com")) {
      const payload = (init?.method ?? "GET") === "GET" ? "[]" : "{}";
      return Promise.resolve(new Response(payload, { status: 200 }));
    }
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

Deno.test("non-quiet diagnose prints findings and posts a PR comment", async () => {
  const { fetch, calls } = routedFetch(
    claudeFixUsage(ONE_EDIT, { input_tokens: 10, output_tokens: 5 }),
  );
  const prEnv: Record<string, string> = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_TOKEN: "tok",
  };
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("").diff((d) => d.text(""))
    .env((name) => prEnv[name]).fetch(fetch);
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
  // A GitHub comment was created (POST after the GET list).
  const posted = calls.some((c) => c.url.includes("api.github.com"));
  assertEquals(posted, true);
});

Deno.test("a non-quiet missing key prints a skip line", async () => {
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = aiFixer((f) => f.provider("claude"))
    .conventions("").diff((d) => d.text("")).env(() => undefined).fetch(fetch);
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
});

Deno.test("the working-tree diff is gathered via git for context", async () => {
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("").env(() => undefined)
    .exec((argv) =>
      Promise.resolve(
        argv[1] === "diff" ? "diff --git a/y b/y\n+changed" : "",
      )
    )
    .fetch(fetch).quiet();
  await fixer.remediate(CTX);
  assertEquals(calls[0].body.includes("diff --git a/y b/y"), true);
});

Deno.test("fetchBase fetches the PR base branch itself for diff context", async () => {
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const git: string[][] = [];
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("")
    .diff((d) => d.fetchBase())
    .env((n) => n === "GITHUB_BASE_REF" ? "master" : undefined)
    .exec((argv) => {
      git.push(argv);
      return Promise.resolve(
        argv[1] === "diff" ? "diff --git a/z b/z\n+base context" : "",
      );
    })
    .fetch(fetch).quiet();
  await fixer.remediate(CTX);
  assertEquals(git[0], [
    "git",
    "fetch",
    "--no-tags",
    "--depth=1",
    "origin",
    "master",
  ]);
  assertEquals(git[1], ["git", "diff", "FETCH_HEAD"]);
  assertEquals(calls[0].body.includes("base context"), true);
});

Deno.test("fetchBase honours an explicit branch and remote", async () => {
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const git: string[][] = [];
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("")
    .diff((d) => d.fetchBase("develop", "upstream"))
    .env(() => undefined)
    .exec((argv) => {
      git.push(argv);
      return Promise.resolve("");
    })
    .fetch(fetch).quiet();
  await fixer.remediate(CTX);
  assertEquals(git[0], [
    "git",
    "fetch",
    "--no-tags",
    "--depth=1",
    "upstream",
    "develop",
  ]);
});

Deno.test("an option-like base branch is rejected, not fetched (no arg injection)", async () => {
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const git: string[][] = [];
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("")
    .diff((d) => d.fetchBase())
    // A hostile GITHUB_BASE_REF that looks like a git option.
    .env((n) => n === "GITHUB_BASE_REF" ? "--upload-pack=evil" : undefined)
    .exec((argv) => {
      git.push(argv);
      return Promise.resolve("");
    })
    .fetch(fetch).quiet();
  await fixer.remediate(CTX);
  assertEquals(git.some((a) => a[1] === "fetch"), false); // never fetched
  assertEquals(git.some((a) => a[1] === "diff" && a.length === 2), true);
});

Deno.test("a failed base fetch falls back to the working-tree diff", async () => {
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const git: string[][] = [];
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("")
    .diff((d) => d.fetchBase("master"))
    .env(() => undefined)
    .exec((argv) => {
      git.push(argv);
      if (argv[1] === "fetch") return Promise.reject(new Error("no network"));
      return Promise.resolve("");
    })
    .fetch(fetch).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
  assertEquals(git.some((a) => a[1] === "diff" && a.length === 2), true);
});

Deno.test("fetchBase with no resolvable base skips the fetch", async () => {
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const git: string[][] = [];
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("")
    .diff((d) => d.fetchBase())
    .env(() => undefined)
    .exec((argv) => {
      git.push(argv);
      return Promise.resolve("");
    })
    .fetch(fetch).quiet();
  await fixer.remediate(CTX);
  assertEquals(git.some((a) => a[1] === "fetch"), false);
  assertEquals(git.some((a) => a[1] === "diff" && a.length === 2), true);
});

Deno.test("a git failure while gathering the diff is tolerated", async () => {
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("").env(() => undefined)
    .exec(() => Promise.reject(new Error("not a git repo")))
    .fetch(fetch).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
});

Deno.test("a non-Error failure value is stringified into the prompt", async () => {
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const s = seams();
  const fixer = s.apply(aiFixer((f) => f.provider("claude").apiKey("k")))
    .fetch(fetch).quiet();
  await fixer.remediate({
    target: "t",
    attempt: 1,
    error: "raw string failure",
  });
  assertEquals(calls[0].body.includes("raw string failure"), true);
});

Deno.test("parseFix normalises confidence and drops malformed edits", () => {
  const fix = parseFix(JSON.stringify({
    diagnosis: "d",
    rootCause: "r",
    confidence: "bogus",
    edits: [
      { path: "a.ts", content: "x" },
      { path: "", content: "y" }, // empty path → dropped
      { path: "b.ts" }, // missing content → dropped
    ],
  }));
  assertEquals(fix.confidence, "low");
  assertEquals(fix.edits, [{ path: "a.ts", content: "x" }]);
});

Deno.test("parseFix unwraps a fenced object and defaults missing strings", () => {
  const fix = parseFix(
    '```json\n{"confidence":"medium","edits":[]}\n```',
  );
  assertEquals(fix.confidence, "medium");
  assertEquals(fix.diagnosis, ""); // missing → default
  assertEquals(fix.rootCause, "");
});

Deno.test("every fluent setter is chainable", () => {
  const f = aiFixer((x) =>
    x.provider("openai").apiKey("k").model("gpt").effort("high")
      .criteria("strict").conventions("rules").include("src/**")
      .exclude("**/*.md").maxDiffTokens(100).autoApply().allowPaths("src/**")
      .excludePaths("dist/**").maxEdits(3).allowCI().commitFixes()
      .commitMessage("m").noPush().comment().noComment().suggest().noSuggest()
      .commentToken("t").retry({ attempts: 1 }).quiet()
  );
  assertEquals(f instanceof AiFixer, true);
});

Deno.test("noComment writes the summary but posts no PR comment", async () => {
  const { fetch, calls } = routedFetch(claudeFix(ONE_EDIT));
  const prEnv: Record<string, string> = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_TOKEN: "tok",
  };
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k").noComment())
    .conventions("").diff((d) => d.text("")).env((n) => prEnv[n]).fetch(fetch)
    .quiet();
  await fixer.remediate(CTX);
  assertEquals(calls.some((c) => c.url.includes("api.github.com")), false);
});

Deno.test("a failed PR comment is swallowed", async () => {
  const calls: string[] = [];
  const prEnv: Record<string, string> = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_TOKEN: "tok",
  };
  const impl = ((input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("api.github.com")) {
      return Promise.resolve(new Response("nope", { status: 500 }));
    }
    return Promise.resolve(new Response(claudeFix(ONE_EDIT), { status: 200 }));
  }) as typeof fetch;
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("").diff((d) => d.text("")).env((n) => prEnv[n]).fetch(impl)
    .quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false); // comment failure never changes the outcome
});

Deno.test("a transient provider failure is retried, announced when not quiet", async () => {
  let n = 0;
  const impl = (() => {
    n++;
    const status = n === 1 ? 503 : 200;
    return Promise.resolve(new Response(claudeFix(ONE_EDIT), { status }));
  }) as typeof fetch;
  const fixer = aiFixer((f) =>
    f.provider("claude").apiKey("k")
      .retry({ attempts: 2, sleep: () => Promise.resolve() })
  ).conventions("").diff((d) => d.text("")).env(() => undefined).fetch(impl);
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
  assertEquals(n, 2);
});

Deno.test("criteria are passed through to the prompt", async () => {
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = aiFixer((f) =>
    f.provider("claude").apiKey("k").criteria("NO ANY")
  )
    .conventions("").diff((d) => d.text("")).env(() => undefined).fetch(fetch)
    .quiet();
  await fixer.remediate(CTX);
  assertEquals(calls[0].body.includes("NO ANY"), true);
});

const FIX_WITH_LOC: Partial<Fix> = {
  diagnosis: "Remove the unused constant.",
  rootCause: "INTENTIONAL_LINT_BREAK is never used.",
  confidence: "high",
  locations: [{
    file: "zuke.ts",
    line: 42,
    endLine: 45,
    code: 'const INTENTIONAL_LINT_BREAK = "remove me";',
    suggestion: "",
  }],
  edits: [{ path: "zuke.ts", content: "// fixed\n" }],
};

/** A fetch routing GitHub PR-detail, review-comment, and provider calls. */
function suggestFetch(fixBody: string): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    if (url.includes("api.github.com")) {
      if (url.includes("/comments")) {
        return Promise.resolve(
          new Response(method === "GET" ? "[]" : "{}", {
            status: method === "GET" ? 200 : 201,
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ head: { sha: "abc123" } }), {
          status: 200,
        }),
      );
    }
    return Promise.resolve(new Response(fixBody, { status: 200 }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

Deno.test("on GitHub with locations, posts inline suggestions, not an overview comment", async () => {
  const { fetch, calls } = suggestFetch(claudeFix(FIX_WITH_LOC));
  const prEnv: Record<string, string> = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_TOKEN: "tok",
  };
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("").diff((d) => d.text("")).env((n) => prEnv[n]).fetch(fetch)
    .quiet();
  await fixer.remediate(CTX);
  const reviewPost = calls.find((c) => c.url.endsWith("/pulls/7/comments"));
  if (reviewPost === undefined) throw new Error("no review comment posted");
  assertEquals(reviewPost.body.includes("```suggestion"), true);
  assertEquals(JSON.parse(reviewPost.body).start_line, 42);
  // The overview issue comment is skipped when suggestions are posted.
  assertEquals(calls.some((c) => c.url.includes("/issues/")), false);
});

Deno.test("noSuggest falls back to the overview comment on GitHub", async () => {
  const { fetch, calls } = suggestFetch(claudeFix(FIX_WITH_LOC));
  const prEnv: Record<string, string> = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_TOKEN: "tok",
  };
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k").noSuggest())
    .conventions("").diff((d) => d.text("")).env((n) => prEnv[n]).fetch(fetch)
    .quiet();
  await fixer.remediate(CTX);
  assertEquals(calls.some((c) => c.url.includes("/issues/")), true);
  assertEquals(calls.some((c) => c.url.endsWith("/pulls/7/comments")), false);
});

Deno.test("parseFix reads locations with verbatim code and line numbers", () => {
  const fix = parseFix(JSON.stringify({
    diagnosis: "d",
    rootCause: "r",
    confidence: "high",
    locations: [
      { file: "a.ts", line: 10, endLine: 12, code: "x", suggestion: "y" },
      { file: "b.ts", line: 3, code: "z" },
      { file: "", line: 1, code: "bad" }, // empty file → dropped
      { file: "c.ts", code: "no line" }, // missing line → dropped
    ],
    edits: [],
  }));
  assertEquals(fix.locations, [
    { file: "a.ts", line: 10, endLine: 12, code: "x", suggestion: "y" },
    { file: "b.ts", line: 3, code: "z" },
  ]);
});

Deno.test("fixMarkdown renders each location as a file:line diff block", () => {
  const md = fixMarkdown("AI fix", "lint", {
    diagnosis: "Remove it.",
    rootCause: "unused",
    confidence: "high",
    locations: [{
      file: "zuke.ts",
      line: 42,
      endLine: 45,
      code: "const X = 1;",
    }],
    files: ["zuke.ts"],
    action: "diagnosed",
  });
  assertEquals(md.includes("#### `zuke.ts:42-45`"), true);
  assertEquals(md.includes("```diff"), true);
  assertEquals(md.includes("-const X = 1;"), true);
});

Deno.test("a single-line location with a replacement renders + and - lines", () => {
  const md = fixMarkdown("AI fix", "lint", {
    diagnosis: "Use const.",
    rootCause: "let",
    confidence: "medium",
    locations: [{
      file: "a.ts",
      line: 7,
      code: "let x = 1;",
      suggestion: "const x = 1;",
    }],
    files: ["a.ts"],
    action: "diagnosed",
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  });
  assertEquals(md.includes("#### `a.ts:7`"), true); // single line: no range
  assertEquals(md.includes("-let x = 1;"), true);
  assertEquals(md.includes("+const x = 1;"), true);
  assertEquals(md.includes("**Tokens:**"), true);
});

Deno.test("a thrown suggestion post is caught and falls back to the overview", async () => {
  const prEnv: Record<string, string> = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_TOKEN: "tok",
  };
  const calls: string[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("api.github.com")) {
      // The PR-detail fetch (for the head sha) throws; the issue-comment GET/POST succeeds.
      if (!url.includes("/comments")) {
        return Promise.reject(new Error("network"));
      }
      const method = init?.method ?? "GET";
      return Promise.resolve(
        new Response(method === "GET" ? "[]" : "{}", { status: 200 }),
      );
    }
    return Promise.resolve(
      new Response(claudeFix(FIX_WITH_LOC), { status: 200 }),
    );
  }) as typeof fetch;
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .conventions("").diff((d) => d.text("")).env((n) => prEnv[n]).fetch(impl)
    .quiet();
  await fixer.remediate(CTX);
  // Suggestion posting threw → fell back to the overview issue comment.
  assertEquals(calls.some((u) => u.includes("/issues/")), true);
});

Deno.test("parseFix tolerates a non-array edits field", () => {
  const fix = parseFix(JSON.stringify({ confidence: "high", edits: "nope" }));
  assertEquals(fix.edits, []);
});

Deno.test("no conventions are sent when none are found", async () => {
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = aiFixer((f) => f.provider("claude").apiKey("k"))
    .diff((d) => d.text("")).env(() => undefined)
    .readFile(() => Promise.resolve(undefined))
    .fetch(fetch).quiet();
  await fixer.remediate(CTX);
  assertEquals(calls[0].body.includes("Project conventions:"), false);
});

Deno.test("conventions default reader reads from disk", async () => {
  // deno.json exists at the repo root (the test cwd); a missing file is undefined.
  assertEquals(typeof await readTextOrUndefined("deno.json"), "string");
  assertEquals(await readTextOrUndefined("does-not-exist.zzz"), undefined);
});

Deno.test("commitAndPush is a no-op when there are nothing to commit", async () => {
  const git: string[][] = [];
  await commitAndPush({
    paths: [],
    message: "m",
    run: (argv) => {
      git.push(argv);
      return Promise.resolve("");
    },
  });
  assertEquals(git.length, 0);
});
