/**
 * Host / CI detection helpers for build scripts. A build can branch on where it
 * runs — e.g. only deploy from CI, or pick coloured output locally.
 *
 * ```ts
 * import { ciHost, isCI } from "jsr:@zuke/core";
 * deploy = target().onlyWhen(() => isCI()).executes(...);
 * ```
 *
 * @module
 */

/** Read an environment variable, treating missing env access as unset. */
function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/**
 * A short identifier for the detected CI host, or `"local"` when not on CI.
 * Recognises GitHub Actions, GitLab CI, and the generic `CI` convention.
 */
export function ciHost(): string {
  if (env("GITHUB_ACTIONS") === "true") return "github-actions";
  if (env("GITLAB_CI") === "true") return "gitlab-ci";
  const ci = env("CI");
  if (ci !== undefined && ci !== "" && ci !== "false") return "ci";
  return "local";
}

/** Whether the build appears to be running in a CI environment. */
export function isCI(): boolean {
  return ciHost() !== "local";
}
