import { assertEquals } from "../../core/tests/_assert.ts";
import { CommandError, CommandOutput } from "@zuke/core/shell";
import { type AgentContext, type AgentFixer, agentFixer } from "../mod.ts";
import { commitAll } from "../src/commit.ts";
import type { RemediationContext } from "@zuke/core";

const CTX: RemediationContext = {
  target: "test",
  attempt: 1,
  error: new Error("boom: a test failed"),
};

/** A runner that records each AgentContext it receives. */
function recorder() {
  const calls: AgentContext[] = [];
  const run = (ctx: AgentContext): Promise<void> => {
    calls.push(ctx);
    return Promise.resolve();
  };
  return { calls, run };
}

/** Apply the hermetic seams (no disk, no real git, local env, no comment). */
function hermetic(f: AgentFixer, git?: string[][]): AgentFixer {
  return f
    .conventions("")
    .env(() => undefined)
    .readFile(() => Promise.resolve(undefined))
    .exec((argv) => {
      git?.push(argv);
      return Promise.resolve(argv[1] === "status" ? " M src/app.ts" : "");
    })
    .quiet();
}

Deno.test("runs the agent and asks the executor to retry", async () => {
  const r = recorder();
  const fixer = hermetic(agentFixer(r.run));
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, true);
  assertEquals(r.calls.length, 1);
  assertEquals(r.calls[0].target, "test");
  assertEquals(r.calls[0].prompt.includes("boom: a test failed"), true);
});

Deno.test("the failed command and stderr feed the prompt", async () => {
  const r = recorder();
  const fixer = hermetic(agentFixer(r.run));
  await fixer.remediate({
    target: "lint",
    attempt: 1,
    error: new CommandError("deno lint", 1, "error: unused variable x"),
  });
  assertEquals(r.calls[0].command, "deno lint");
  assertEquals(r.calls[0].prompt.includes("deno lint"), true);
  assertEquals(r.calls[0].prompt.includes("unused variable x"), true);
});

Deno.test("the agent is gated off CI unless allowCI is set", async () => {
  const r = recorder();
  const ciEnv = (n: string) => n === "GITHUB_ACTIONS" ? "true" : undefined;
  const fixer = agentFixer(r.run).conventions("").readFile(() =>
    Promise.resolve(undefined)
  ).env(ciEnv).quiet();
  const blocked = await fixer.remediate(CTX);
  assertEquals(blocked.retry, false);
  assertEquals(r.calls.length, 0); // never ran the agent on CI

  const allowed = await fixer.allowCI().remediate(CTX);
  assertEquals(allowed.retry, true);
  assertEquals(r.calls.length, 1);
});

Deno.test("commitFixes stages all changes, commits, and pushes", async () => {
  const git: string[][] = [];
  const r = recorder();
  const fixer = hermetic(agentFixer(r.run, (f) => f.commitFixes()), git);
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, true);
  assertEquals(git, [
    ["git", "add", "-A"],
    ["git", "status", "--porcelain"],
    ["git", "commit", "-m", 'Apply Zuke agent fix for "test"'],
    ["git", "push"],
  ]);
});

Deno.test("commitFixes makes no commit when the agent changed nothing", async () => {
  const git: string[][] = [];
  const r = recorder();
  const fixer = agentFixer(r.run, (f) => f.commitFixes())
    .conventions("").env(() => undefined).readFile(() =>
      Promise.resolve(undefined)
    )
    .exec((argv) => {
      git.push(argv);
      return Promise.resolve(""); // clean working tree
    })
    .quiet();
  await fixer.remediate(CTX);
  assertEquals(git, [
    ["git", "add", "-A"],
    ["git", "status", "--porcelain"],
  ]); // no commit, no push
});

Deno.test("a failed push is reported but the fix still retries", async () => {
  const r = recorder();
  const fixer = agentFixer(r.run, (f) => f.commitFixes())
    .conventions("").env(() => undefined).readFile(() =>
      Promise.resolve(undefined)
    )
    .exec((argv) => {
      if (argv[1] === "push") return Promise.reject(new Error("no upstream"));
      return Promise.resolve(argv[1] === "status" ? " M x" : "");
    })
    .quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, true);
});

Deno.test("a failing agent run is swallowed (no retry, build failure intact)", async () => {
  const fixer = hermetic(
    agentFixer(() => Promise.reject(new Error("agent crashed"))),
  );
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
});

Deno.test("noPush commits without pushing, with a custom message", async () => {
  const git: string[][] = [];
  const r = recorder();
  const fixer = hermetic(
    agentFixer(
      r.run,
      (f) => f.commitFixes().noPush().commitMessage("fix: heal"),
    ),
    git,
  );
  await fixer.remediate(CTX);
  assertEquals(git, [
    ["git", "add", "-A"],
    ["git", "status", "--porcelain"],
    ["git", "commit", "-m", "fix: heal"],
  ]);
});

Deno.test("conventions and criteria reach the prompt", async () => {
  const r = recorder();
  const fixer = agentFixer(r.run, (f) => f.criteria("NO ANY"))
    .conventions("Never use any.").env(() => undefined).quiet();
  await fixer.remediate(CTX);
  assertEquals(r.calls[0].prompt.includes("Never use any."), true);
  assertEquals(r.calls[0].prompt.includes("NO ANY"), true);
});

Deno.test("the agent's stdout is captured and posted as a PR comment", async () => {
  const prEnv: Record<string, string> = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_TOKEN: "tok",
  };
  const calls: { url: string; body: string }[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    const payload = method === "GET" ? "[]" : "{}";
    return Promise.resolve(new Response(payload, { status: 200 }));
  }) as typeof fetch;
  const fixer = agentFixer(() =>
    Promise.resolve(new CommandOutput(0, "Fixed the unused variable.", ""))
  )
    .allowCI().conventions("").readFile(() => Promise.resolve(undefined))
    .env((n) => prEnv[n]).fetch(impl).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, true);
  // The POST carries the agent's stdout in the comment body.
  const posted = calls.some((c) =>
    c.url.includes("/comments") && c.body.includes("Fixed the unused variable.")
  );
  assertEquals(posted, true);
});

Deno.test("suggest mode posts the agent's diff as inline suggestions, no commit, no retry", async () => {
  const prEnv: Record<string, string> = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_TOKEN: "tok",
  };
  const diff = [
    "diff --git a/zuke.ts b/zuke.ts",
    "--- a/zuke.ts",
    "+++ b/zuke.ts",
    "@@ -45,1 +45,1 @@",
    '-const X = "remove me";',
    '+const _X = "remove me";',
  ].join("\n");
  const git: string[][] = [];
  const calls: { url: string; body: string }[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    if (url.includes("/comments")) {
      return Promise.resolve(
        new Response(method === "GET" ? "[]" : "{}", { status: 200 }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ head: { sha: "abc123" } }), {
        status: 200,
      }),
    );
  }) as typeof fetch;
  const fixer = agentFixer(() => Promise.resolve())
    .allowCI().suggest().conventions("").readFile(() =>
      Promise.resolve(undefined)
    )
    .env((n) => prEnv[n])
    .exec((argv) => {
      git.push(argv);
      return Promise.resolve(argv[1] === "diff" ? diff : "");
    })
    .fetch(impl).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false); // proposal mode — build stays failed
  // It read the agent's diff and never committed.
  assertEquals(git.some((a) => a[1] === "diff"), true);
  assertEquals(git.some((a) => a[1] === "commit"), false);
  // A review comment with a suggestion block was posted.
  const posted = calls.some((c) =>
    c.url.endsWith("/pulls/7/comments") && c.body.includes("```suggestion")
  );
  assertEquals(posted, true);
});

Deno.test("suggest mode off GitHub reports no committable suggestions", async () => {
  const r = recorder();
  const fixer = agentFixer(r.run, (f) => f.suggest())
    .conventions("").env(() => undefined).readFile(() =>
      Promise.resolve(undefined)
    )
    .exec(() => Promise.resolve("")).quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
  assertEquals(r.calls.length, 1); // the agent still ran
});

Deno.test("suggest mode tolerates a git diff failure", async () => {
  const prEnv: Record<string, string> = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_TOKEN: "tok",
  };
  const fixer = agentFixer(() => Promise.resolve())
    .allowCI().suggest().conventions("").readFile(() =>
      Promise.resolve(undefined)
    )
    .env((n) => prEnv[n])
    .exec((argv) =>
      argv[1] === "diff"
        ? Promise.reject(new Error("no HEAD"))
        : Promise.resolve("")
    )
    .noComment().quiet();
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, false);
});

Deno.test("noComment writes no PR comment", async () => {
  const prEnv: Record<string, string> = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_REF: "refs/pull/7/merge",
    GITHUB_TOKEN: "tok",
  };
  const calls: string[] = [];
  const impl = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(new Response("[]", { status: 200 }));
  }) as typeof fetch;
  const fixer = agentFixer(() => Promise.resolve("done"))
    .allowCI().noComment().conventions("").readFile(() =>
      Promise.resolve(undefined)
    )
    .env((n) => prEnv[n]).fetch(impl).quiet();
  await fixer.remediate(CTX);
  assertEquals(calls.some((u) => u.includes("api.github.com")), false);
});

Deno.test("a non-quiet run prints what the agent did", async () => {
  const r = recorder();
  const fixer = agentFixer(r.run).conventions("").env(() => undefined)
    .readFile(() => Promise.resolve(undefined));
  const result = await fixer.remediate(CTX);
  assertEquals(result.retry, true);
});

Deno.test("commitAll is a no-op on a clean tree and commits on a dirty one", async () => {
  const clean: string[][] = [];
  await commitAll({
    message: "m",
    run: (argv) => {
      clean.push(argv);
      return Promise.resolve(""); // porcelain empty
    },
  });
  assertEquals(clean, [["git", "add", "-A"], ["git", "status", "--porcelain"]]);

  const dirty: string[][] = [];
  await commitAll({
    message: "m",
    push: false,
    run: (argv) => {
      dirty.push(argv);
      return Promise.resolve(argv[1] === "status" ? " M f" : "");
    },
  });
  assertEquals(dirty, [
    ["git", "add", "-A"],
    ["git", "status", "--porcelain"],
    ["git", "commit", "-m", "m"],
  ]);
});
