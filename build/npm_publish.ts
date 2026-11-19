// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Publishing the compiled packages (`dist/npm/<name>`, see `npm_build.ts`) to
 * npm as `@zuke-build/<name>`, and registering each one's trusted publisher.
 */

import { HttpError, httpJson } from "@zuke/core";
import { $ } from "@zuke/core/shell";
import { NpmTasks } from "@zuke/npm";
import { NPM_SCOPE } from "./npm_manifest.ts";
import { NPM_DIST } from "./npm_build.ts";

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

/** Publish the compiled `pkg` with provenance: the real {@link NpmPublishDeps.publish}. */
export async function publishToNpm(pkg: string): Promise<void> {
  await NpmTasks.publish((s) =>
    s.cwd(NPM_DIST(pkg)).access("public").provenance()
  );
}

/** What {@link publishAllToNpm} needs, injected so it is testable offline. */
export interface NpmPublishDeps {
  /** The version `pkg` releases from this commit; `"0.0.0"` means none yet. */
  versionOf(pkg: string): Promise<string>;
  /** Whether `pkg`@`version` is on npm. */
  isPublished(pkg: string, version: string): Promise<boolean>;
  /** Publish the compiled `pkg`. */
  publish(pkg: string): Promise<void>;
  /** Report progress. */
  info(message: string): void;
  /** Report a version that did not land, and why. */
  failed(message: string): void;
}

/**
 * Publish every package's pending version to npm, in `packages` order (a
 * package after the ones it depends on). A version already on npm is skipped,
 * so a re-run finishes what failed. A package that fails is reported and the
 * walk carries on, except that one whose dependency failed is not tried: npm
 * would resolve a range its dependency's new version does not yet satisfy.
 *
 * @throws {Error} after the last package, naming every version that did not land.
 */
export async function publishAllToNpm(
  packages: readonly string[],
  dependencies: Readonly<Record<string, readonly string[]>>,
  deps: NpmPublishDeps,
): Promise<void> {
  const missing = new Set<string>();
  const failures: string[] = [];
  for (const pkg of packages) {
    const version = await deps.versionOf(pkg);
    if (version === "0.0.0") {
      deps.info(`@zuke/${pkg} has no released version yet.`);
      continue;
    }
    const name = `${NPM_SCOPE}/${pkg}@${version}`;
    try {
      if (await deps.isPublished(pkg, version)) {
        deps.info(`${name} is already on npm.`);
        continue;
      }
      const needs = pkg === "core"
        ? []
        : ["core", ...(dependencies[pkg] ?? [])];
      const blocker = needs.find((dependency) => missing.has(dependency));
      if (blocker !== undefined) {
        throw new Error(`its dependency @zuke/${blocker} did not land.`);
      }
      deps.info(`Publishing ${name} to npm...`);
      await deps.publish(pkg);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      deps.failed(`${name} did not publish: ${reason}`);
      missing.add(pkg);
      failures.push(name);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} package version(s) did not reach npm: ` +
        `${failures.join(", ")}. Re-run once the cause is fixed — a version ` +
        "already on npm is skipped.",
    );
  }
}

/**
 * Register the release workflow as `pkg`'s trusted publisher, so publishing
 * from CI needs no token. Needs npm 11.15 or later, and a maintainer's
 * 2FA-authenticated login, and the package must already exist on npm.
 */
export async function trustPublisher(pkg: string): Promise<void> {
  // `NpmTasks` has no `trust` task yet; the argv is discrete, never a shell line.
  await $`npm trust github ${NPM_SCOPE}/${pkg} --file ${TRUSTED_WORKFLOW} --repo ${TRUSTED_REPOSITORY} --allow-publish --yes`;
}
