// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The scope gate shared by both fixers: where each is allowed to act, and what
 * it does on the side of the boundary it is not allowed on.
 *
 * The case that motivates `.runOnly("ci")` is a build whose own lint target carries
 * a fixer with `.autoApply()` and `.commitFixes()`. Before it existed, the only
 * gate was `.runOnly("both")`, which widens to *both* hosts — so there was no way to
 * say "heal the pull request, never touch my working tree", and a local run
 * against a red tree would rewrite, commit and push it.
 *
 * @module
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import { type AgentContext, type AgentFixer, agentFixer } from "../mod.ts";
import { type AiFixer, aiFixer, type Fix } from "../mod.ts";
// Internal to the package: the public surface is `.runOnly("both")` / `.runOnly("ci")` on
// the two fixers, so the rule itself is imported from its module.
import { outOfScope } from "../src/run_scope.ts";
import type { RemediationContext } from "@zuke/core";

const CTX: RemediationContext = {
  target: "lint",
  attempt: 1,
  error: new Error("boom: a test failed"),
};

/** An env reader that looks like a GitHub Actions runner. */
const ON_CI = (name: string) => name === "GITHUB_ACTIONS" ? "true" : undefined;
/** An env reader that looks like a developer's machine. */
const OFF_CI = () => undefined;

Deno.test("outOfScope answers for every scope on both hosts", () => {
  // "both" is the only scope that permits acting anywhere.
  assertEquals(outOfScope("both", ON_CI), undefined);
  assertEquals(outOfScope("both", OFF_CI), undefined);
  // The default: apply locally, refuse on CI.
  assertEquals(outOfScope("local", OFF_CI), undefined);
  assertEquals(outOfScope("local", ON_CI)?.where, "on CI");
  assertEquals(
    outOfScope("local", ON_CI)?.hint,
    '.runOnly("ci") or .runOnly("both")',
  );
  // The inverse, which is what did not exist before.
  assertEquals(outOfScope("ci", ON_CI), undefined);
  assertEquals(outOfScope("ci", OFF_CI)?.where, "outside CI");
  assertEquals(
    outOfScope("ci", OFF_CI)?.hint,
    '.runOnly("both") to also run locally',
  );
});

/** A recorded fetch call, so a test can prove the model was never asked. */
function recordFetch(body: string): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(new Response(body, { status: 200 }));
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

const ONE_EDIT: Partial<Fix> = {
  diagnosis: "off-by-one in loop",
  rootCause: "wrong bound",
  confidence: "high",
  edits: [{ path: "src/app.ts", content: "export const x = 1;\n" }],
};

/** Seams that make an {@link AiFixer} hermetic, recording writes and git argv. */
function seams(env: (name: string) => string | undefined) {
  const writes: string[] = [];
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
        .write((path) => {
          writes.push(path);
          return Promise.resolve();
        })
        .env(env)
        .quiet();
    },
  };
}

Deno.test('runOnly("ci"): off CI the fixer never calls the model or writes', async () => {
  const s = seams(OFF_CI);
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s
    .apply(
      aiFixer((f) =>
        f.provider("claude").apiKey("k").autoApply().runOnly("ci")
      ),
    )
    .fetch(fetch);

  const result = await fixer.remediate(CTX);

  assertEquals(result.retry, false);
  assertEquals(s.writes, []);
  assertEquals(s.git, []);
  // The point of returning before the model: a failing local build costs
  // nothing against the developer's key.
  assertEquals(calls, []);
});

Deno.test('runOnly("ci"): on CI the same fixer applies and commits', async () => {
  const s = seams(ON_CI);
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s
    .apply(
      aiFixer((f) =>
        f.provider("claude").apiKey("k").runOnly("ci").commitFixes().noComment()
      ),
    )
    .fetch(fetch);

  const result = await fixer.remediate(CTX);

  assertEquals(result.retry, true);
  assertEquals(s.writes, ["src/app.ts"]);
  assertEquals(calls.length, 1);
  assertEquals(s.git.some((argv) => argv.includes("commit")), true);
});

Deno.test('the default scope still diagnoses on CI — "ci" is the stronger refusal', async () => {
  // The two refusals are deliberately different, and this pins the difference:
  // the default declines the write but still explains the failure on the pull
  // request, while "ci" off CI does not run at all.
  const s = seams(ON_CI);
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s
    .apply(aiFixer((f) => f.provider("claude").apiKey("k").autoApply()))
    .fetch(fetch);

  const result = await fixer.remediate(CTX);

  assertEquals(result.retry, false);
  assertEquals(s.writes, []);
  assertEquals(calls.length, 1);
});

Deno.test("the deprecated allowCI still selects both hosts", async () => {
  // It is published API, so it keeps working exactly as it did — it is now a
  // one-line alias for the scope that says the same thing.
  const s = seams(OFF_CI);
  const { fetch } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s
    .apply(
      aiFixer((f) => f.provider("claude").apiKey("k").autoApply().allowCI()),
    )
    .fetch(fetch);

  assertEquals((await fixer.remediate(CTX)).retry, true);
  assertEquals(s.writes, ["src/app.ts"]);
});

Deno.test("one axis, so a later runOnly simply replaces the earlier scope", async () => {
  // The reason for a single setter rather than an opposing pair: there is no
  // ordering in which a build ends up with a scope it did not name last, and
  // no combination that has to be documented as a special case.
  const s = seams(OFF_CI);
  const { fetch, calls } = recordFetch(claudeFix(ONE_EDIT));
  const fixer = s
    .apply(
      aiFixer((f) =>
        f.provider("claude").apiKey("k").autoApply().runOnly("both").runOnly(
          "ci",
        )
      ),
    )
    .fetch(fetch);

  assertEquals((await fixer.remediate(CTX)).retry, false);
  assertEquals(s.writes, []);
  assertEquals(calls, []);
});

/** A runner that records each AgentContext it receives. */
function recorder() {
  const calls: AgentContext[] = [];
  const run = (ctx: AgentContext): Promise<void> => {
    calls.push(ctx);
    return Promise.resolve();
  };
  return { calls, run };
}

/** The hermetic seams for an {@link AgentFixer}, with a chosen env reader. */
function hermetic(f: AgentFixer, env: (name: string) => string | undefined) {
  let statusCalls = 0;
  return f
    .conventions("")
    .env(env)
    .readFile(() => Promise.resolve(undefined))
    .exec((argv) => {
      if (argv[1] === "status") {
        statusCalls++;
        return Promise.resolve(statusCalls === 1 ? "" : " M src/app.ts");
      }
      return Promise.resolve("");
    })
    .quiet();
}

Deno.test('agentFixer runOnly("ci"): the agent is never started off CI', async () => {
  const r = recorder();
  const fixer = hermetic(agentFixer(r.run).runOnly("ci").noComment(), OFF_CI);

  const result = await fixer.remediate(CTX);

  assertEquals(result.retry, false);
  // An agent reads and edits files autonomously, so not starting it is the
  // whole guarantee.
  assertEquals(r.calls, []);
});

Deno.test('agentFixer runOnly("ci"): the agent runs on CI', async () => {
  const r = recorder();
  const fixer = hermetic(agentFixer(r.run).runOnly("ci").noComment(), ON_CI);

  const result = await fixer.remediate(CTX);

  assertEquals(result.retry, true);
  assertEquals(r.calls.length, 1);
});

Deno.test('an unrecognised CI host counts as local, and "ci" fails closed there', () => {
  // detectCiHost knows GitHub, GitLab, Azure and Bitbucket. Everywhere else —
  // CircleCI, Jenkins, a bare CI=true — reads as local. Pinning it because the
  // consequence is asymmetric and worth knowing about rather than discovering:
  // "local" applies on such a runner, while "ci" skips every run.
  for (
    const env of [
      () => undefined,
      (n: string) => (n === "CI" ? "true" : undefined),
      (n: string) => (n === "JENKINS_URL" ? "http://jenkins" : undefined),
    ]
  ) {
    assertEquals(outOfScope("local", env), undefined);
    assertEquals(outOfScope("ci", env)?.where, "outside CI");
  }
});
