// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { CiFile, target } from "@zuke/core";
import {
  assertEquals,
  assertThrows,
} from "../../../packages/core/tests/_assert.ts";
import { ciFileOf, type ManifestCi } from "../src/ci.ts";
import { parseManifest } from "../src/protocol.ts";

/** Parse a manifest whose only content is the `ci` list. */
function parsed(ci: unknown[]): readonly ManifestCi[] {
  return parseManifest({ name: "B", targets: [], ci }).ci;
}

/** A pipeline with every field set, as an SDK would send it. */
const PIPELINE = {
  name: "Gate",
  triggers: {
    push: ["main"],
    pullRequest: [],
    pushPaths: { paths: ["src/**"] },
    pullRequestPaths: { pathsIgnore: ["docs/**"] },
    pullRequestTypes: ["opened", "edited"],
    manual: true,
    issueComment: ["created"],
    branchProtectionRule: true,
    schedule: [{ cron: "30 9 * * 1-5", tz: "Europe/Sofia" }, {
      cron: "0 0 * * 0",
    }],
  },
  permissions: { contents: "read" },
  concurrency: { group: "gate-${{ github.ref }}", cancelInProgress: true },
  harden: {
    action: "step-security/harden-runner@sha",
    egress: "block",
    allowedEndpoints: ["jsr.io:443"],
    name: "Harden",
  },
  checkout: {
    action: { ref: "actions/checkout@sha", version: "v5" },
    persistCredentials: false,
    ref: "main",
    fetchDepth: 0,
    name: "Checkout",
  },
  bootstrap: {
    action: "zuke-build/zuke@sha",
    denoVersion: "2.x",
    actionsCache: true,
    name: "Bootstrap",
  },
  jobs: [{
    id: "scan",
    name: "Scan",
    runsOn: "ubuntu-latest",
    needs: ["lint"],
    matrix: { os: ["ubuntu-latest", "windows-latest"], shard: [1, 2] },
    matrixInclude: [{ os: "macos-latest", shard: 1 }],
    matrixExclude: [{ os: "windows-latest", shard: 2 }],
    failFast: false,
    permissions: { "security-events": "write" },
    harden: false,
    checkout: { fetchDepth: 1 },
    bootstrap: false,
    env: { CI: "1" },
    environment: { name: "staging", url: "https://staging.example" },
    outputs: { url: "${{ steps.deploy.outputs.url }}" },
    if: "github.event_name == 'push'",
    timeoutMinutes: 30,
    concurrency: { group: "scan" },
    steps: [{
      name: "Scan",
      id: "scan",
      if: "always()",
      shell: "bash",
      continueOnError: true,
      run: "./zuke scan",
      uses: "org/scan@sha",
      with: { token: "${{ secrets.TOKEN }}" },
      env: { LEVEL: "high" },
    }],
  }],
};

/** An invocation with every field set. */
const INVOCATION = {
  target: "test",
  id: "unit",
  after: ["lint"],
  environment: "ci",
  before: [{ run: "echo before" }],
  then: [{ run: "echo after" }],
  steps: [{ run: "./zuke test --verbose" }],
};

/** Every field a `ci` entry can carry. */
const FULL = {
  name: "ciWorkflow",
  provider: "github",
  path: ".github/workflows/gate.yml",
  pipeline: PIPELINE,
  invokes: ["lint", INVOCATION],
  fanOut: {
    setupSteps: [{ run: "echo setup" }],
    runsOn: "ubuntu-latest",
    includeUnlisted: true,
    env: { ZUKE_REMOTE_CACHE: "s3" },
  },
  pins: {
    "actions/checkout": { ref: "actions/checkout@sha", version: "v5" },
    "zuke-build/zuke": "zuke-build/zuke@sha",
  },
};

Deno.test("parseCi carries every field of a cicd spec, with targets as names", () => {
  // A round trip: the parsed entry holds exactly the fields given, no more.
  const [entry] = parsed([FULL]);
  assertEquals<unknown>(entry, {
    ...FULL,
    invokes: [{ target: "lint" }, INVOCATION],
  });
  assertEquals(parsed([{ name: "ci" }]), [{ name: "ci" }]);
  assertEquals(parsed([{ name: "ci", fanOut: true }]), [{
    name: "ci",
    fanOut: true,
  }]);
  assertEquals(
    parsed([{ name: "ci", pipeline: { jobs: [{ harden: false }] } }]),
    [{ name: "ci", pipeline: { jobs: [{ harden: false }] } }],
  );
});

Deno.test("parseCi names the malformed field", () => {
  const refuse = (entry: Record<string, unknown>, message: string) =>
    assertThrows(() => parsed([{ name: "ci", ...entry }]), Error, message);
  refuse(
    { provider: "jenkins" },
    'manifest.ci[0]: field "provider" must be one of github, gitlab, azure, bitbucket',
  );
  refuse({ invokes: "lint" }, 'field "invokes" must be an array');
  refuse(
    { invokes: [{ id: "x" }] },
    'manifest.ci[0].invokes[0]: missing field "target"',
  );
  refuse({ invokes: [1] }, "manifest.ci[0].invokes[0]: expected an object");
  refuse(
    { pipeline: { harden: { egress: "allow" } } },
    'manifest.ci[0].pipeline.harden: field "egress" must be one of audit, block',
  );
  refuse(
    { pipeline: { checkout: { action: { version: "v5" } } } },
    'manifest.ci[0].pipeline.checkout.action: missing field "ref"',
  );
  refuse({
    pipeline: { triggers: { pushPaths: { paths: ["a"], pathsIgnore: ["b"] } } },
  }, 'field "pathsIgnore" must not be set together with "paths"');
  refuse(
    { pipeline: { triggers: { pushPaths: {} } } },
    'manifest.ci[0].pipeline.triggers.pushPaths: missing field "pathsIgnore"',
  );
  refuse(
    { pipeline: { jobs: [{ matrix: ["os"] }] } },
    'manifest.ci[0].pipeline.jobs[0]: field "matrix" must map each axis to its values',
  );
  refuse(
    { pipeline: { jobs: [{ matrix: { os: "ubuntu" } }] } },
    'field "matrix.os" must be an array of strings and numbers',
  );
  refuse(
    { pipeline: { jobs: [{ matrix: { os: [true] } }] } },
    'field "matrix.os" must be an array of strings and numbers',
  );
  refuse(
    { pipeline: { jobs: [{ matrixInclude: { os: "x" } }] } },
    'field "matrixInclude" must be an array of rows',
  );
  refuse(
    { pipeline: { jobs: [{ matrixInclude: ["x"] }] } },
    'field "matrixInclude[0]" must be an object',
  );
  refuse(
    { pipeline: { jobs: [{ matrixExclude: [{ os: null }] }] } },
    'field "matrixExclude[0].os" must be a string or a number',
  );
  refuse(
    { pipeline: { jobs: [{ environment: { url: "u" } }] } },
    'manifest.ci[0].pipeline.jobs[0].environment: missing field "name"',
  );
  refuse(
    { pipeline: { jobs: [{ concurrency: {} }] } },
    'manifest.ci[0].pipeline.jobs[0].concurrency: missing field "group"',
  );
  refuse(
    { pipeline: { jobs: [{ steps: [{ continueOnError: "yes" }] }] } },
    'manifest.ci[0].pipeline.jobs[0].steps[0]: field "continueOnError" must be a boolean',
  );
  refuse(
    { pipeline: { bootstrap: { actionsCache: 1 } } },
    'field "actionsCache" must be a boolean',
  );
  refuse(
    { pipeline: { triggers: { schedule: [{}] } } },
    'manifest.ci[0].pipeline.triggers.schedule[0]: missing field "cron"',
  );
  refuse({ fanOut: "yes" }, "manifest.ci[0].fanOut: expected an object");
  refuse({ pins: ["a"] }, 'field "pins" must map action names to pins');
  refuse(
    { pins: { "actions/checkout": 1 } },
    "manifest.ci[0].pins.actions/checkout: expected an object",
  );
});

Deno.test("ciFileOf resolves the invoked targets and answers pins from the map", () => {
  const lint = target();
  const test = target().dependsOn(lint);
  const targets = new Map([["lint", lint], ["test", test]]);
  const asked: string[] = [];
  const targetOf = (name: string, where: string): typeof lint => {
    asked.push(`${where}:${name}`);
    const found = targets.get(name);
    if (found === undefined) throw new Error(`no ${name}`);
    return found;
  };
  // `invokes` and `fanOut` exclude each other, as `cicd` says when given both.
  const { fanOut, ...invoking } = FULL;
  const [entry] = parsed([invoking]);
  const file = ciFileOf(entry, targetOf);
  assertEquals(file instanceof CiFile, true);
  assertEquals(file.provider, "github");
  assertEquals(file.path, ".github/workflows/gate.yml");
  assertEquals(file.explicitPath, true);
  assertEquals<unknown>(file.pipeline, PIPELINE);
  assertEquals(file.fanOut, undefined);
  const [fanning] = parsed([{ name: "all", fanOut }]);
  assertEquals<unknown>(ciFileOf(fanning, targetOf).fanOut, fanOut);
  // A bare name parses to an invocation of nothing but its target, which
  // `cicd` reads exactly as the bare reference.
  const [bare, full] = (file.invokes ?? []).map((i) =>
    "target" in i ? i : { target: i }
  );
  assertEquals(Object.keys(bare), ["target"]);
  assertEquals(bare.target, lint);
  const { target: invoked, after, ...rest } = full;
  assertEquals(invoked, test);
  assertEquals(after, [lint]);
  const { target: _t, after: _a, ...expected } = INVOCATION;
  assertEquals<unknown>(rest, expected);
  assertEquals(asked, [
    'ci "ciWorkflow":lint',
    'ci "ciWorkflow":test',
    'ci "ciWorkflow"\'s "after":lint',
  ]);
  assertThrows(
    () => ciFileOf(parsed([FULL])[0], targetOf),
    Error,
    "use either `invokes`",
  );
  assertEquals(file.pins?.("zuke-build/zuke"), "zuke-build/zuke@sha");
  assertEquals(file.pins?.("actions/checkout"), {
    ref: "actions/checkout@sha",
    version: "v5",
  });
  assertThrows(
    () => file.pins?.("step-security/harden-runner"),
    Error,
    'manifest: ci "ciWorkflow" pins no "step-security/harden-runner"',
  );

  // Nothing but a name: the provider's default path, no pins, no invocations.
  const [plain] = parsed([{ name: "ci" }]);
  const bareFile = ciFileOf(plain, targetOf);
  assertEquals(bareFile.path, ".github/workflows/ci.yml");
  assertEquals(bareFile.explicitPath, false);
  assertEquals(bareFile.pins, undefined);
  assertEquals(bareFile.invokes, undefined);
});
