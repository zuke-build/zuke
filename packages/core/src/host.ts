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

/** Read an environment variable, treating missing env access as unset. */
function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

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
  env: (name: string) => string | undefined = readEnv,
): CiHost {
  if (env("GITHUB_ACTIONS") === "true") return "github";
  if (env("GITLAB_CI") === "true") return "gitlab";
  if (env("TF_BUILD") === "True") return "azure";
  const bitbucket = env("BITBUCKET_BUILD_NUMBER");
  if (bitbucket !== undefined && bitbucket !== "") return "bitbucket";
  return "local";
}

/**
 * A short identifier for the detected CI host, or `"local"` when not on CI.
 * Recognises GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket Pipelines,
 * and the generic `CI` convention.
 *
 * Prefer {@link detectCiHost} for new code: its values match {@link CiProvider}.
 * This function is kept for compatibility and uses longer, host-specific names.
 */
export function ciHost(): string {
  switch (detectCiHost()) {
    case "github":
      return "github-actions";
    case "gitlab":
      return "gitlab-ci";
    case "azure":
      return "azure-pipelines";
    case "bitbucket":
      return "bitbucket-pipelines";
    case "local": {
      const ci = readEnv("CI");
      return ci !== undefined && ci !== "" && ci !== "false" ? "ci" : "local";
    }
  }
}

/** Whether the build appears to be running in a CI environment. */
export function isCI(): boolean {
  return ciHost() !== "local";
}
