/**
 * Per-CI-host PR-comment dispatch. {@link detectReviewHost} reads the ambient
 * environment, picks the right {@link ReviewHost} for the active provider
 * (GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket Pipelines), and the
 * {@link "./reviewer.ts".Reviewer} uses it to post its assessment without
 * knowing which provider it's on.
 *
 * @module
 */

import { type CiHost, detectCiHost } from "@zuke/core";
import { azureHost } from "./hosts/azure.ts";
import { bitbucketHost } from "./hosts/bitbucket.ts";
import { githubHost } from "./hosts/github.ts";
import { gitlabHost } from "./hosts/gitlab.ts";
import { type EnvReader, readEnv, type ReviewHost } from "./hosts/types.ts";

export type { EnvReader, ReviewHost, UpsertComment } from "./hosts/types.ts";
export { readEnv } from "./hosts/types.ts";
export { azureHost, bitbucketHost, githubHost, gitlabHost };

/** The hosts a review can post to, keyed by {@link CiHost}. */
const HOSTS: Partial<Record<CiHost, ReviewHost>> = {
  github: githubHost,
  gitlab: gitlabHost,
  azure: azureHost,
  bitbucket: bitbucketHost,
};

/** The {@link ReviewHost} for `host`, if one is registered. */
export function hostFor(host: CiHost): ReviewHost | undefined {
  return HOSTS[host];
}

/**
 * The {@link ReviewHost} for the active CI provider, detected from the
 * environment, or `undefined` when running locally or under an unrecognised CI.
 */
export function detectReviewHost(
  env: EnvReader = readEnv,
): ReviewHost | undefined {
  return hostFor(detectCiHost(env));
}
