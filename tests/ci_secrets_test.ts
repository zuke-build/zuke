// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Regression tests for which CI jobs hold which secrets.
 *
 * The repository accepts, deliberately, that a same-repo pull request runs with
 * live secrets and a write-scoped token: the lint fixer pushes its fix to the
 * branch and Codecov uploads from pull-request runs. `docs/assurance-case.md`
 * names that adversary and that residual.
 *
 * What must not happen is the exposure widening by accident — a secret added to
 * a job that had none, a `pull_request_target` trigger appearing, credentials
 * persisted in a job that has no reason to push. None of those breaks a build,
 * so nothing else would notice. These pin the current shape so a change to it
 * has to be deliberate.
 *
 * They read the committed YAML rather than the declaration in
 * `build/workflows.ts`, because that is what GitHub runs; the gate's
 * `generate-ci --check` proves the two agree.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { isRecord, jobsOf, readWorkflow } from "./_workflow.ts";

const CI = ".github/workflows/ci.yml";
const AI_REVIEW = ".github/workflows/ai-review.yml";

/** Every `secrets.NAME` a job's own text refers to, sorted and deduplicated. */
function secretsOf(job: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const match of JSON.stringify(job).matchAll(/secrets\.([A-Z0-9_]+)/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

/** Every job in a committed workflow, keyed by id. */
function jobs(path: string): Map<string, Record<string, unknown>> {
  return jobsOf(readWorkflow(path));
}

Deno.test("only the gate job in ci.yml holds secrets", async (t) => {
  const found = new Map(
    [...jobs(CI)].map(([id, job]) => [id, secretsOf(job)]),
  );
  await t.step("the gate holds exactly the three it needs", () => {
    // OPENAI_API_KEY for the lint fixer, GITHUB_TOKEN for its push and comment,
    // CODECOV_TOKEN for the coverage upload. A fourth arriving here is the
    // change this test exists to catch.
    assertEquals(found.get("ci"), [
      "CODECOV_TOKEN",
      "GITHUB_TOKEN",
      "OPENAI_API_KEY",
    ]);
  });
  await t.step("every other job holds none", () => {
    for (const [id, secrets] of found) {
      if (id === "ci") continue;
      assertEquals(secrets, [], `${id} should hold no secrets`);
    }
  });
});

Deno.test("the ai-review job holds only what posting a review needs", () => {
  const review = jobs(AI_REVIEW).get("review");
  assertEquals(review === undefined, false);
  assertEquals(secretsOf(review ?? {}), ["GITHUB_TOKEN", "OPENAI_API_KEY"]);
});

Deno.test("no workflow triggers on pull_request_target", async () => {
  // The trigger that would run a fork's code with this repository's secrets.
  // Nothing here uses it, and nothing should start to without the change being
  // argued for.
  for await (const entry of Deno.readDir(".github/workflows")) {
    if (!entry.name.endsWith(".yml")) continue;
    const workflow = readWorkflow(`.github/workflows/${entry.name}`);
    // `on` is YAML 1.1 truthy, so a parser may key it as `true`.
    const on = workflow.on ?? workflow[String(true)];
    const triggers = isRecord(on) ? Object.keys(on) : [];
    assertEquals(
      triggers.includes("pull_request_target"),
      false,
      `${entry.name} triggers on pull_request_target`,
    );
  }
});

Deno.test("only the gate persists credentials, and only it needs to", () => {
  // A persisted token is what lets the fixer push. Any other job keeping one in
  // git config would be holding a push capability it never uses.
  for (const [id, job] of jobs(CI)) {
    const persists = JSON.stringify(job).includes(
      '"persist-credentials":"true"',
    );
    assertEquals(
      persists,
      id === "ci",
      `${id}: unexpected persist-credentials`,
    );
  }
});

Deno.test("the gate blocks egress and the review job does not", () => {
  // Recorded rather than aspirational: the review job audits, which is why
  // `docs/assurance-case.md` claims blocking only for jobs that hold a
  // write-scoped token. If that changes, the prose has to change with it.
  const gate = JSON.stringify(jobs(CI).get("ci") ?? {});
  assertEquals(gate.includes('"egress-policy":"block"'), true);
  const review = JSON.stringify(jobs(AI_REVIEW).get("review") ?? {});
  assertEquals(review.includes('"egress-policy":"audit"'), true);
});
