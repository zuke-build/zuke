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
