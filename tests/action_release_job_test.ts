// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the generated `actionRelease` job in `.github/workflows/release.yml`.
 *
 * The job is generated, and `generate-ci` already fails CI on drift — so this
 * is not about the file matching the generator. It is about the properties that
 * make the job safe to run unattended, which a later edit to the generator
 * could remove while leaving everything green: the job holds no
 * `GITHUB_TOKEN`, it is granted no write permission, and its egress is blocked.
 *
 * Asserted against the committed YAML rather than the generator's own output,
 * because the committed file is what GitHub actually runs.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { actionOf, isRecord, jobIn, stepsOf } from "./_workflow.ts";

/** The `actionRelease` job as the committed workflow declares it. */
function actionReleaseJob(): Record<string, unknown> {
  return jobIn(".github/workflows/release.yml", "actionRelease");
}

Deno.test("the action release job is granted no write permission", () => {
  // It writes plenty — tags, a branch, a pull request — but not with this
  // credential. Everything goes through an app installation token minted
  // inside the target, so a `contents: write` here would be an unused grant
  // that a later change could quietly start relying on.
  assertEquals(actionReleaseJob().permissions, { contents: "read" });
});

Deno.test("the action release job holds no GITHUB_TOKEN", () => {
  // GITHUB_TOKEN cannot do this job: there is no `workflows` permission to
  // grant it, so it may not write the regenerated `.github/workflows/*`, and a
  // pull request it opened would trigger no checks and so could never satisfy
  // the ruleset requiring them. Passing one anyway would mean a run that half
  // works and fails somewhere less obvious.
  const env = stepsOf(actionReleaseJob()).flatMap((step) =>
    isRecord(step.env) ? Object.keys(step.env) : []
  );
  assertEquals(env.includes("GITHUB_TOKEN"), false);
  assertEquals(env.includes("ZUKE_BUILD_APP_ID"), true);
  assertEquals(env.includes("ZUKE_BUILD_APP_KEY"), true);
});

Deno.test("the action release job blocks egress and persists no credential", () => {
  // The block bounds where a credential read out of this job could be sent; it
  // is not what stops the credential existing, which is what the API-based
  // writes address. Both, because neither is sufficient alone.
  const checkout = stepsOf(actionReleaseJob()).find((step) =>
    actionOf(step) === "zuke-build/zuke"
  );
  if (checkout === undefined || !isRecord(checkout.with)) {
    throw new Error("the job does not check out with the Zuke action");
  }
  assertEquals(checkout.with["egress-policy"], "block");
  assertEquals(checkout.with["persist-credentials"], "false");
  // Full history: the tag list is how the next version is computed, and a
  // shallow checkout reads an empty list and tries to re-cut v1.0.0 over a tag
  // that already exists.
  assertEquals(checkout.with["fetch-depth"], "0");
});

Deno.test("the action release job can reach what it actually calls", () => {
  // Every call the target makes is to the REST API — minting the app token,
  // the tags, the branch, the pull request. A blocked allowlist that omits it
  // would fail the job at its first write, after the release job has already
  // run.
  const checkout = stepsOf(actionReleaseJob()).find((step) =>
    isRecord(step.with) && typeof step.with["allowed-endpoints"] === "string"
  );
  if (checkout === undefined || !isRecord(checkout.with)) {
    throw new Error("the job declares no allowed endpoints");
  }
  const allowed = String(checkout.with["allowed-endpoints"]).split(/\s+/);
  assertEquals(allowed.some((e) => e === "api.github.com:443"), true);
  assertEquals(allowed.some((e) => e === "github.com:443"), true);
});
