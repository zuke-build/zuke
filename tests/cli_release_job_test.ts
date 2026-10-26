// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the CLI binary release jobs in `.github/workflows/release.yml`.
 *
 * `generate-ci --check` already fails CI when the file drifts from the
 * generator; these pin the properties that keep the jobs safe to run
 * unattended, which a later edit to the generator could quietly remove: where
 * the signing secrets may go, which job may write what, that a failed stage
 * stops everything after it, and that nothing is published unsigned or
 * unattested.
 *
 * Asserted against the committed YAML, which is what GitHub runs.
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

const RELEASE = ".github/workflows/release.yml";

/** The release workflow's jobs. */
function jobs(): Map<string, Record<string, unknown>> {
  return jobsOf(readWorkflow(RELEASE));
}

/** One release job, failing the test if it is missing. */
function job(id: string): Record<string, unknown> {
  const found = jobs().get(id);
  if (found === undefined) throw new Error(`${RELEASE} has no ${id} job`);
  return found;
}

/** Every env key a job's steps or the job itself are given. */
function envKeys(id: string): string[] {
  const subject = job(id);
  return [
    ...(isRecord(subject.env) ? Object.keys(subject.env) : []),
    ...stepsOf(subject).flatMap((step) =>
      isRecord(step.env) ? Object.keys(step.env) : []
    ),
  ];
}

const APPLE_SECRETS = [
  "APPLE_CERTIFICATE_P12",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_NOTARY_KEY",
  "APPLE_NOTARY_KEY_ID",
  "APPLE_NOTARY_ISSUER",
];

Deno.test("the CLI release stages run in order, each after the one it reads from", () => {
  const needs = (id: string) => job(id).needs;
  assertEquals(needs("cliBinaries"), ["publishJsr"]);
  assertEquals(needs("cliSign"), ["cliBinaries"]);
  assertEquals(needs("cliUpload"), ["cliBinaries", "cliSign"]);
  assertEquals(needs("cliFormulaVerify"), ["cliBinaries", "cliUpload"]);
  assertEquals(needs("cliTap"), ["cliBinaries", "cliFormulaVerify"]);
  assertEquals(needs("cliChocolateyVerify"), ["cliBinaries", "cliUpload"]);
  assertEquals(needs("cliChocolatey"), ["cliBinaries", "cliChocolateyVerify"]);
});

Deno.test("the Apple signing secrets reach only the macOS signing job, in its environment", () => {
  for (const [id, subject] of jobs()) {
    const held = envKeys(id).filter((key) => APPLE_SECRETS.includes(key));
    if (id === "cliSign") {
      assertEquals(held.sort(), [...APPLE_SECRETS].sort());
      // The environment is where the secrets live, and where a deployment
      // rule can require approval before anything is signed.
      assertEquals(subject.environment, "cli-signing");
      assertEquals(subject["runs-on"], "macos-latest");
      assertEquals(subject.permissions, { contents: "read" });
    } else {
      assertEquals(held, [], id);
    }
  }
});

Deno.test("only the upload job may write the release or sign an attestation", () => {
  assertEquals(job("cliUpload").permissions, {
    contents: "write",
    "id-token": "write",
    attestations: "write",
  });
  for (
    const id of [
      "cliBinaries",
      "cliSign",
      "cliFormulaVerify",
      "cliTap",
      "cliChocolateyVerify",
      "cliChocolatey",
    ]
  ) {
    assertEquals(job(id).permissions, { contents: "read" }, id);
  }
});

Deno.test("the upload attests the archives and the manifest before uploading them", () => {
  const steps = stepsOf(job("cliUpload"));
  const order = steps.map((step) =>
    actionOf(step) ?? (typeof step.run === "string" ? step.run : "")
  );
  const at = (entry: string) => order.indexOf(entry);
  const attest = at("actions/attest-build-provenance");
  assertEquals(attest > at("./zuke cliPackage"), true, order.join(", "));
  assertEquals(at("./zuke cliUpload") > attest, true, order.join(", "));
  const attestStep = steps[attest];
  const subjects = isRecord(attestStep.with)
    ? attestStep.with["subject-path"]
    : "";
  assertEquals(
    String(subjects).trim().split("\n"),
    [
      "dist/cli/release/*.tar.gz",
      "dist/cli/release/*.zip",
      "dist/cli/release/SHA256SUMS",
    ],
  );
  // The bundle the attestation step wrote is what the upload publishes.
  const upload = steps[at("./zuke cliUpload")];
  assertEquals(
    isRecord(upload.env) ? upload.env.CLI_ATTESTATION_BUNDLE : undefined,
    "${{ steps.attest.outputs.bundle-path }}",
  );
});

Deno.test("the upload publishes the signed macOS binaries, not the unsigned ones", () => {
  const downloads = stepsOf(job("cliUpload")).filter((step) =>
    actionOf(step) === "actions/download-artifact"
  ).map((step) => isRecord(step.with) ? step.with.name : undefined);
  // The signed artifact is fetched last, over the unsigned copies.
  assertEquals(downloads, ["cli-binaries", "cli-binaries-signed"]);
});

Deno.test("nothing is verified or tapped unless the upload it depends on succeeded", () => {
  const verify = String(job("cliFormulaVerify").if);
  for (
    const part of [
      "!cancelled()",
      "needs.cliBinaries.outputs.tap == 'true'",
      "needs.cliBinaries.outputs.build != 'true' || needs.cliUpload.result == 'success'",
    ]
  ) {
    assertEquals(verify.includes(part), true, verify);
  }
  assertEquals(
    job("cliTap").if,
    "${{ !cancelled() && needs.cliFormulaVerify.result == 'success' }}",
  );
  for (const id of ["cliSign", "cliUpload"]) {
    assertEquals(job(id).if, "needs.cliBinaries.outputs.build == 'true'", id);
  }
});

Deno.test("the Chocolatey API key reaches only the push job, in its environment", () => {
  for (const [id, subject] of jobs()) {
    const held = envKeys(id).includes("CHOCOLATEY_API_KEY");
    assertEquals(held, id === "cliChocolatey", id);
    if (id === "cliChocolatey") {
      assertEquals(subject.environment, "chocolatey");
      assertEquals(subject["runs-on"], "windows-latest");
    }
  }
});

Deno.test("the Chocolatey package is verified only after a settled upload, and pushed only once verified and CHOCOLATEY_PUSH is enabled", () => {
  const verify = String(job("cliChocolateyVerify").if);
  for (
    const part of [
      "!cancelled()",
      "needs.cliBinaries.outputs.chocolatey == 'true'",
      "needs.cliBinaries.outputs.build != 'true' || needs.cliUpload.result == 'success'",
    ]
  ) {
    assertEquals(verify.includes(part), true, verify);
  }
  assertEquals(
    job("cliChocolatey").if,
    "${{ !cancelled() && needs.cliChocolateyVerify.result == 'success' && " +
      "vars.CHOCOLATEY_PUSH == 'enabled' }}",
  );
});

Deno.test("the tap job holds the app key with egress blocked, and no GITHUB_TOKEN", () => {
  const keys = envKeys("cliTap");
  assertEquals(keys.includes("ZUKE_BUILD_APP_KEY"), true);
  assertEquals(keys.includes("GITHUB_TOKEN"), false);
  const prelude = stepsOf(job("cliTap"))[0];
  assertEquals(
    isRecord(prelude.with) ? prelude.with["egress-policy"] : undefined,
    "block",
  );
});

Deno.test("the formula is verified with the real brew on macOS and Linux", () => {
  const verify = job("cliFormulaVerify");
  assertEquals(
    isRecord(verify.strategy) && isRecord(verify.strategy.matrix)
      ? verify.strategy.matrix.os
      : undefined,
    ["macos-latest", "ubuntu-latest"],
  );
  assertEquals(
    isRecord(verify.strategy) ? verify.strategy["fail-fast"] : undefined,
    false,
  );
});
