// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Regression tests for the committed `scorecard.yml` — the job that publishes
 * the OpenSSF Scorecard behind the README badge.
 *
 * scorecard.dev verifies the workflow before it accepts a published score, and
 * the job that holds `ossf/scorecard-action` may consist only of `uses:` steps
 * from a short allowlist: no `run:` step, no other action, no job-level `env`,
 * an Ubuntu runner, and `id-token: write` on that job alone. A violation is
 * rejected with a 400 that the action reports as a *warning*, so the job stays
 * green while the badge silently stops moving — which is exactly what happened
 * when the Zuke prelude and a `./zuke` step replaced the allowlisted actions
 * (issue #514): every publish from 2026-08-06 on was refused, and nothing
 * noticed for a month.
 *
 * These assert the committed artifact rather than the declaration in
 * `build/workflows.ts`, because the artifact is what GitHub runs: the gate's
 * `generate-ci --check` already proves the two agree, so pinning the
 * properties here pins them in both places. The allowlist is the one in
 * https://github.com/ossf/scorecard-action#workflow-restrictions.
 *
 * @module
 */

import { parse } from "@std/yaml";
import { assertEquals } from "../packages/core/tests/_assert.ts";

const WORKFLOW = ".github/workflows/scorecard.yml";

/** The action that computes and publishes the score. */
const SCORECARD_ACTION = "ossf/scorecard-action";

/**
 * The only actions scorecard.dev permits in the publishing job — the action
 * itself, the two prelude halves, and the two ways of getting its report out.
 */
const ALLOWED_ACTIONS: ReadonlySet<string> = new Set([
  SCORECARD_ACTION,
  "actions/checkout",
  "actions/create-github-app-token",
  "actions/upload-artifact",
  "github/codeql-action/upload-sarif",
  "step-security/harden-runner",
]);

/** Whether a parsed YAML value is an object that can be indexed. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The committed workflow, parsed. */
function workflow(): Record<string, unknown> {
  const parsed = parse(Deno.readTextFileSync(WORKFLOW));
  if (!isRecord(parsed) || !isRecord(parsed.jobs)) {
    throw new Error(`${WORKFLOW} has no jobs`);
  }
  return parsed;
}

/** Every job in the workflow, keyed by id. */
function jobs(): Map<string, Record<string, unknown>> {
  const { jobs } = workflow();
  if (!isRecord(jobs)) throw new Error(`${WORKFLOW} has no jobs`);
  return new Map(
    Object.entries(jobs).flatMap(([id, job]) =>
      isRecord(job) ? [[id, job]] : []
    ),
  );
}

/** A job's steps, each as a record. */
function stepsOf(job: Record<string, unknown>): Record<string, unknown>[] {
  const { steps } = job;
  if (!Array.isArray(steps)) throw new Error("the job has no steps");
  return steps.filter(isRecord);
}

/** The action a `uses:` names, without its pin. */
function actionOf(uses: unknown): string {
  if (typeof uses !== "string") throw new Error(`uses is not a string`);
  return uses.split("@")[0];
}

/**
 * The id of the one job that runs the scorecard action, found the way
 * scorecard.dev's verifier finds it: by the step, not by the job id.
 */
function scorecardJobId(all: Map<string, Record<string, unknown>>): string {
  for (const [id, job] of all) {
    const runs = stepsOf(job).some((step) =>
      actionOf(step.uses ?? "") === SCORECARD_ACTION
    );
    if (runs) return id;
  }
  throw new Error(`${WORKFLOW} has no job that runs ${SCORECARD_ACTION}`);
}

/** The job that runs the scorecard action. */
function scorecardJob(): Record<string, unknown> {
  const all = jobs();
  const job = all.get(scorecardJobId(all));
  if (job === undefined) throw new Error("unreachable: the id came from all");
  return job;
}

Deno.test("the scorecard job runs only allowlisted actions, and no `run:` step", () => {
  // The rule that was broken: the Zuke prelude is not on the list, and a
  // `./zuke` step is a `run:`. Either one turns every publish into a 400.
  const offending = stepsOf(scorecardJob()).flatMap((step) => {
    if (step.run !== undefined) return [`run: ${String(step.run)}`];
    const action = actionOf(step.uses);
    return ALLOWED_ACTIONS.has(action) ? [] : [`uses: ${action}`];
  });
  assertEquals(
    offending,
    [],
    `scorecard.dev would refuse to publish: ${offending.join(", ")}`,
  );
});

Deno.test("the scorecard job carries no job-level env, container, or services", () => {
  const job = scorecardJob();
  assertEquals(job.env, undefined);
  assertEquals(job.container, undefined);
  assertEquals(job.services, undefined);
  assertEquals(job.defaults, undefined);
});

Deno.test("the scorecard job runs on a hosted Ubuntu runner", () => {
  const runsOn = scorecardJob()["runs-on"];
  assertEquals(typeof runsOn, "string");
  assertEquals(/^ubuntu-(latest|\d{2}\.\d{2})$/.test(String(runsOn)), true);
});

Deno.test("only the scorecard job may hold id-token: write", () => {
  // The verifier rejects a workflow where any *other* job can mint an OIDC
  // token, and any workflow-level write permission at all.
  const file = workflow();
  const top = file.permissions;
  if (isRecord(top)) {
    assertEquals(Object.values(top).includes("write"), false);
    assertEquals(Object.values(top).includes("write-all"), false);
  } else {
    assertEquals(top, undefined);
  }
  assertEquals(file.env, undefined);
  assertEquals(file.defaults, undefined);
  const all = jobs();
  const scorecard = scorecardJobId(all);
  for (const [id, job] of all) {
    const perms = isRecord(job.permissions) ? job.permissions : {};
    assertEquals(
      perms["id-token"] === "write",
      id === scorecard,
      "id-token: write belongs to the scorecard job and no other",
    );
  }
});

Deno.test("the scorecard job publishes its score and uploads the same SARIF", () => {
  // `publish_results` is what refreshes the badge; `upload-sarif` reading the
  // file the scorecard step wrote is what puts the findings on the Security
  // tab. The two names must agree or the upload fails after the score is
  // already published.
  const steps = stepsOf(scorecardJob());
  const scorecard = steps.find((step) =>
    actionOf(step.uses) === SCORECARD_ACTION
  );
  const upload = steps.find((step) =>
    actionOf(step.uses) === "github/codeql-action/upload-sarif"
  );
  if (scorecard === undefined || upload === undefined) {
    throw new Error("the scorecard or upload-sarif step is missing");
  }
  const scorecardWith = isRecord(scorecard.with) ? scorecard.with : {};
  const uploadWith = isRecord(upload.with) ? upload.with : {};
  assertEquals(scorecardWith.publish_results, "true");
  assertEquals(scorecardWith.results_format, "sarif");
  assertEquals(uploadWith.sarif_file, scorecardWith.results_file);
});

Deno.test("every action in scorecard.yml is pinned to a full SHA", () => {
  for (const job of jobs().values()) {
    for (const step of stepsOf(job)) {
      const uses = String(step.uses);
      assertEquals(
        /@[0-9a-f]{40}$/.test(uses),
        true,
        `not pinned to a full SHA: ${uses}`,
      );
    }
  }
});
