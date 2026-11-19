// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Publishing the compiled packages (`dist/npm/<name>`, see `npm_build.ts`) to
 * npm as `@zuke-build/<name>`, and registering each one's trusted publisher.
 */

import { ConsoleTasks } from "@zuke/console";
import { HttpError, httpJson } from "@zuke/core";
import { $ } from "@zuke/core/shell";
import { NpmTasks } from "@zuke/npm";
import { NPM_SCOPE } from "./npm_manifest.ts";
import { NPM_DIST } from "./npm_build.ts";
import type { PublishRegistry } from "./publish.ts";

/**
 * The GitHub Environment the npm publish job runs in. `NPM_TOKEN` is its
 * secret, and the trusted publisher is bound to it, so only a job in this
 * environment (whose deployment branches are limited to `master`) can publish.
 */
export const NPM_ENVIRONMENT = "npm";

/** The workflow npm is told to trust, and the repository it runs in. */
export const TRUSTED_WORKFLOW = "release.yml";
/** `owner/name` of the repository whose workflow npm is told to trust. */
export const TRUSTED_REPOSITORY = "zuke-build/zuke";

/** Whether `@zuke-build/<pkg>`@`version` is on the npm registry. */
export async function isPublishedToNpm(
  pkg: string,
  version: string,
): Promise<boolean> {
  try {
    const meta = await httpJson(
      `https://registry.npmjs.org/${NPM_SCOPE}%2f${pkg}`,
    );
    return typeof meta === "object" && meta !== null && "versions" in meta &&
      typeof meta.versions === "object" && meta.versions !== null &&
      version in meta.versions;
  } catch (error) {
    // A package never published is an answer, not a failure.
    if (error instanceof HttpError && error.status === 404) return false;
    throw error;
  }
}

/** Publish the compiled `pkg` with provenance. */
export async function publishToNpm(pkg: string): Promise<void> {
  await NpmTasks.publish((s) =>
    s.cwd(NPM_DIST(pkg)).access("public").provenance()
  );
}

/** npm as a {@link PublishRegistry}: what `publishNpm` hands to `publishAllTo`. */
export const NPM_REGISTRY: PublishRegistry = {
  name: "npm",
  packageName: (pkg) => `${NPM_SCOPE}/${pkg}`,
  isPublished: isPublishedToNpm,
  publish: (pkg, version) => {
    ConsoleTasks.info(`Publishing ${NPM_SCOPE}/${pkg}@${version} to npm...`);
    return publishToNpm(pkg);
  },
};

/**
 * Register the release workflow, in the {@link NPM_ENVIRONMENT} environment,
 * as `pkg`'s trusted publisher, so publishing from CI needs no token. Needs npm 11.15 or later, and a maintainer's
 * 2FA-authenticated login, and the package must already exist on npm.
 */
export async function trustPublisher(pkg: string): Promise<void> {
  // `NpmTasks` has no `trust` task yet; the argv is discrete, never a shell line.
  await $`npm trust github ${NPM_SCOPE}/${pkg} --file ${TRUSTED_WORKFLOW} --repo ${TRUSTED_REPOSITORY} --environment ${NPM_ENVIRONMENT} --allow-publish --yes`;
}
