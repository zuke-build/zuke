// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Host / CI detection helpers for build scripts. A build can branch on where it
 * runs — e.g. only deploy from CI, pick coloured output locally, or post a PR
 * comment using the active host's API.
 *
 * ```ts
 * import { detectCiHost, isCI } from "jsr:@zuke/core";
 * deploy = target().onlyWhen(() => isCI()).executes(...);
 * if (detectCiHost() === "gitlab") { ... }
 * ```
 *
 * @module
 */

import { defaultReadEnv } from "./internal.ts";

/**
 * The CI host a build is running on, or `"local"` when not on CI. The names
 * match {@link CiProvider} so they compose with CI generation and per-host
 * integrations (e.g. posting a review to the right pull-request API).
 */
export type CiHost = "github" | "gitlab" | "azure" | "bitbucket" | "local";

/**
 * Detect the CI host from the environment. Recognises GitHub Actions
 * (`GITHUB_ACTIONS`), GitLab CI (`GITLAB_CI`), Azure Pipelines (`TF_BUILD`), and
 * Bitbucket Pipelines (`BITBUCKET_BUILD_NUMBER`); anything else is `"local"`.
 * The reader is injectable so detection can be unit-tested hermetically.
 */
export function detectCiHost(
  env: (name: string) => string | undefined = defaultReadEnv,
): CiHost {
  if (env("GITHUB_ACTIONS") === "true") return "github";
  if (env("GITLAB_CI") === "true") return "gitlab";
  if (env("TF_BUILD") === "True") return "azure";
  const bitbucket = env("BITBUCKET_BUILD_NUMBER");
  if (bitbucket !== undefined && bitbucket !== "") return "bitbucket";
  return "local";
}

/**
 * Environment variables that mean "some CI system is running this", beyond the
 * four hosts {@link detectCiHost} names.
 *
 * A CI system Zuke has no specific support for is still CI, and treating it as a
 * developer's machine is the dangerous direction: a fixer scoped to CI silently
 * stops running, and one left at its default applies changes to what it believes
 * is a working tree someone is editing. Jenkins is the case that matters most —
 * it sets none of the four, and does not set `CI` either.
 *
 * Presence is what counts for all but `CI`, whose conventional "not CI" value is
 * the string `false`.
 */
const GENERIC_CI_MARKERS = [
  "CI",
  "JENKINS_URL",
  "BUILDKITE",
  "CIRCLECI",
  "TRAVIS",
  "TEAMCITY_VERSION",
];

/** Whether any generic marker says this is CI. */
function genericCi(env: (name: string) => string | undefined): boolean {
  return GENERIC_CI_MARKERS.some((name) => {
    const value = env(name);
    if (value === undefined || value === "") return false;
    return name !== "CI" || value !== "false";
  });
}

/**
 * A short identifier for the detected CI host, or `"local"` when not on CI.
 * Recognises GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket Pipelines,
 * and — as the generic `"ci"` — the common markers other systems set, including
 * Jenkins, Buildkite, CircleCI, Travis and TeamCity.
 *
 * Prefer {@link detectCiHost} for new code: its values match {@link CiProvider}.
 * This function is kept for compatibility and uses longer, host-specific names.
 *
 * @param env The environment reader, injectable so detection can be unit-tested
 *   hermetically; defaults to the process environment. {@link detectCiHost} has
 *   taken one since it was written, and this takes the same one so a caller that
 *   wants "am I on CI?" does not have to reach for the host-specific function to
 *   get a testable answer.
 */
export function ciHost(
  env: (name: string) => string | undefined = defaultReadEnv,
): string {
  switch (detectCiHost(env)) {
    case "github":
      return "github-actions";
    case "gitlab":
      return "gitlab-ci";
    case "azure":
      return "azure-pipelines";
    case "bitbucket":
      return "bitbucket-pipelines";
    case "local":
      return genericCi(env) ? "ci" : "local";
  }
}

/**
 * Whether the build appears to be running in a CI environment.
 *
 * Broader than `detectCiHost(env) !== "local"`, which answers only whether the
 * host is one of the four Zuke names: a system it has no specific support for is
 * still CI, and this says so.
 *
 * @param env The environment reader; defaults to the process environment.
 */
export function isCI(
  env: (name: string) => string | undefined = defaultReadEnv,
): boolean {
  return ciHost(env) !== "local";
}

/**
 * The operating systems Zuke recognises — Deno's raw `Deno.build.os` values
 * normalised to a friendly set (notably `darwin` → `macos`). Used across the
 * ecosystem so builds branch on `"macos"` rather than the surprising `"darwin"`.
 */
export type OperatingSystem = "linux" | "macos" | "windows";

/** The CPU architectures Zuke recognises. */
export type Architecture = "x86_64" | "aarch64";

/**
 * The operating system as a Zuke {@link OperatingSystem}: `darwin` becomes
 * `macos`, `windows` stays `windows`, and every other Unix (`linux`, the BSDs,
 * `solaris`, …) is reported as `linux`. Pass a raw `Deno.build.os` value to
 * normalise it; defaults to the running host — the platform analogue of
 * {@link isCI}.
 *
 * ```ts
 * import { operatingSystem } from "jsr:@zuke/core";
 * if (operatingSystem() === "macos") { ... }
 * ```
 */
export function operatingSystem(
  os: typeof Deno.build.os = Deno.build.os,
): OperatingSystem {
  switch (os) {
    case "darwin":
      return "macos";
    case "windows":
      return "windows";
    default:
      return "linux";
  }
}
