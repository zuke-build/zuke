// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import {
  type CiHost,
  ciHost,
  detectCiHost,
  isCI,
  operatingSystem,
} from "../src/host.ts";
import { withEnv as withScopedEnv } from "./_env.ts";

/** All CI-host env signals, for clearing the ambient environment in a test. */
const HOST_VARS = [
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "TF_BUILD",
  "BITBUCKET_BUILD_NUMBER",
  "CI",
];

/**
 * Run `fn` with `vars` applied on top of a cleared set of host signals, so the
 * ambient environment (a real CI run) can't leak into a detection test.
 */
function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const cleared = Object.fromEntries(HOST_VARS.map((key) => [key, undefined]));
  return withScopedEnv({ ...cleared, ...vars }, fn);
}

/** An env reader over a fixed map, for hermetic detectCiHost tests. */
function envMap(
  map: Record<string, string>,
): (name: string) => string | undefined {
  return (name) => map[name];
}

Deno.test("detectCiHost recognises each provider from its signal", () => {
  const cases: Array<[Record<string, string>, CiHost]> = [
    [{ GITHUB_ACTIONS: "true" }, "github"],
    [{ GITLAB_CI: "true" }, "gitlab"],
    [{ TF_BUILD: "True" }, "azure"],
    [{ BITBUCKET_BUILD_NUMBER: "42" }, "bitbucket"],
    [{}, "local"],
    [{ CI: "true" }, "local"], // generic CI is not one of the known hosts
  ];
  for (const [env, expected] of cases) {
    assertEquals(detectCiHost(envMap(env)), expected);
  }
});

Deno.test("detectCiHost precedence prefers GitHub, then GitLab, then Azure", () => {
  assertEquals(
    detectCiHost(envMap({ GITHUB_ACTIONS: "true", GITLAB_CI: "true" })),
    "github",
  );
  assertEquals(
    detectCiHost(envMap({ GITLAB_CI: "true", TF_BUILD: "True" })),
    "gitlab",
  );
  // An empty Bitbucket build number is not a signal.
  assertEquals(detectCiHost(envMap({ BITBUCKET_BUILD_NUMBER: "" })), "local");
});

Deno.test("ciHost maps hosts to their long names; isCI follows", async () => {
  await withEnv({ GITHUB_ACTIONS: "true" }, () => {
    assertEquals(ciHost(), "github-actions");
    assertEquals(isCI(), true);
  });
  await withEnv({ GITLAB_CI: "true" }, () => {
    assertEquals(ciHost(), "gitlab-ci");
    assertEquals(isCI(), true);
  });
  await withEnv({ TF_BUILD: "True" }, () => {
    assertEquals(ciHost(), "azure-pipelines");
    assertEquals(isCI(), true);
  });
  await withEnv({ BITBUCKET_BUILD_NUMBER: "7" }, () => {
    assertEquals(ciHost(), "bitbucket-pipelines");
    assertEquals(isCI(), true);
  });
  await withEnv({ CI: "true" }, () => {
    assertEquals(ciHost(), "ci"); // generic CI convention
    assertEquals(isCI(), true);
  });
  await withEnv({}, () => {
    assertEquals(ciHost(), "local");
    assertEquals(isCI(), false);
  });
});

Deno.test("operatingSystem normalises Deno's os names to a friendly union", () => {
  assertEquals(operatingSystem("darwin"), "macos"); // the key normalisation
  assertEquals(operatingSystem("windows"), "windows");
  assertEquals(operatingSystem("linux"), "linux");
  // Other Unixes bucket under linux.
  assertEquals(operatingSystem("freebsd"), "linux");
  assertEquals(operatingSystem("android"), "linux");
  // Defaults to the running host.
  const host = operatingSystem();
  assertEquals(["linux", "macos", "windows"].includes(host), true);
});

Deno.test("isCI recognises a CI system Zuke has no specific support for", () => {
  // The dangerous direction is reading CI as local: a fixer scoped to CI stops
  // running, and one at its default applies changes to what it believes is a
  // working tree someone is editing. Jenkins is the case that matters — it sets
  // none of the four hosts, and does not set `CI` either.
  for (
    const marker of [
      "JENKINS_URL",
      "BUILDKITE",
      "CIRCLECI",
      "TRAVIS",
      "TEAMCITY_VERSION",
    ]
  ) {
    const env = (name: string) => name === marker ? "set" : undefined;
    assertEquals(isCI(env), true, `${marker} should read as CI`);
    assertEquals(ciHost(env), "ci", `${marker} should read as generic CI`);
    // The host-specific answer is unchanged: these are not one of the four.
    assertEquals(detectCiHost(env), "local");
  }
});

Deno.test("a developer's machine is still local", () => {
  assertEquals(isCI(() => undefined), false);
  assertEquals(ciHost(() => undefined), "local");
});

Deno.test("CI=false is not CI, but another marker set to false still is", () => {
  // `CI` has a conventional "not CI" value; the others are presence-only, so a
  // literal "false" in one of them is still a set marker.
  assertEquals(isCI((name) => name === "CI" ? "false" : undefined), false);
  assertEquals(isCI((name) => name === "CI" ? "" : undefined), false);
  assertEquals(
    isCI((name) => name === "BUILDKITE" ? "false" : undefined),
    true,
  );
});

Deno.test("a named host still wins over the generic markers", () => {
  const env = (name: string) =>
    name === "GITHUB_ACTIONS"
      ? "true"
      : name === "JENKINS_URL"
      ? "x"
      : undefined;
  assertEquals(ciHost(env), "github-actions");
  assertEquals(detectCiHost(env), "github");
});

Deno.test("ciHost and isCI default to the process environment", () => {
  // The reader is an added optional parameter, so every existing call site keeps
  // reading the real environment — the property that makes this non-breaking.
  assertEquals(typeof ciHost(), "string");
  assertEquals(typeof isCI(), "boolean");
});
