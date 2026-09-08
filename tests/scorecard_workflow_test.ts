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
 * Only the Scorecard-specific rules live here. That every `uses:` is pinned to
 * a full SHA is the security gate's job (zizmor's unpinned-uses audit), and the
 * YAML reading is the shared `_workflow.ts`. The allowlist is the one in
 * https://github.com/ossf/scorecard-action#workflow-restrictions.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import {
  actionOf,
  isRecord,
  jobsOf,
  readWorkflow,
  stepsOf,
} from "./_workflow.ts";

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

/**
 * The id of the one job that runs the scorecard action, found the way
 * scorecard.dev's verifier finds it: by the step, not by the job id.
 */
function scorecardJobId(all: Map<string, Record<string, unknown>>): string {
  for (const [id, job] of all) {
    if (stepsOf(job).some((step) => actionOf(step) === SCORECARD_ACTION)) {
      return id;
    }
  }
  throw new Error(`${WORKFLOW} has no job that runs ${SCORECARD_ACTION}`);
}

/** The job that runs the scorecard action. */
function scorecardJob(): Record<string, unknown> {
  const all = jobsOf(readWorkflow(WORKFLOW));
  const job = all.get(scorecardJobId(all));
  if (job === undefined) throw new Error("unreachable: the id came from all");
  return job;
}

Deno.test("the scorecard job runs only allowlisted actions, and no `run:` step", () => {
  // The rule that was broken: the Zuke prelude is not on the list, and a
  // `./zuke` step is a `run:`. Either one turns every publish into a 400.
  const offending = stepsOf(scorecardJob()).flatMap((step) => {
    const action = actionOf(step);
    if (action === undefined) return [`run: ${String(step.run)}`];
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
  const file = readWorkflow(WORKFLOW);
  const top = file.permissions;
  if (isRecord(top)) {
    assertEquals(Object.values(top).includes("write"), false);
    assertEquals(Object.values(top).includes("write-all"), false);
  } else {
    assertEquals(top, undefined);
  }
  assertEquals(file.env, undefined);
  assertEquals(file.defaults, undefined);
  const all = jobsOf(file);
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
  const scorecard = steps.find((step) => actionOf(step) === SCORECARD_ACTION);
  const upload = steps.find((step) =>
    actionOf(step) === "github/codeql-action/upload-sarif"
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
