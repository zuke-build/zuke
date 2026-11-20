// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Publishing the compiled packages (`dist/npm/<name>`, see `npm_build.ts`) to
 * npm as `@zuke-build/<name>`, and registering each one's trusted publisher.
 */

import { ConsoleTasks } from "@zuke/console";
import { HttpError, httpJson } from "@zuke/core";
import { NpmTasks } from "@zuke/npm";
import { NPM_SCOPE } from "./npm_manifest.ts";
import { NPM_DIST } from "./npm_build.ts";
import { type ReleaseProbe, releaseSourceProblem } from "./npm_release.ts";
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

/**
 * npm as a {@link PublishRegistry}: what `publishNpm` hands to `publishAllTo`.
 * A version is published only when this checkout's `packages/<pkg>` is its
 * release tag's source ({@link releaseSourceProblem}), so npm `X.Y.Z` is the
 * source JSR `X.Y.Z` has; otherwise that package fails and the walk goes on.
 * `git` is the seam to the tags.
 */
export function npmRegistry(git?: ReleaseProbe): PublishRegistry {
  return {
    name: "npm",
    packageName: (pkg) => `${NPM_SCOPE}/${pkg}`,
    isPublished: isPublishedToNpm,
    async publish(pkg, version) {
      const problem = await releaseSourceProblem(pkg, version, git);
      if (problem !== null) throw new Error(problem);
      ConsoleTasks.info(`Publishing ${NPM_SCOPE}/${pkg}@${version} to npm...`);
      await publishToNpm(pkg);
    },
  };
}

/**
 * Register the release workflow, in the {@link NPM_ENVIRONMENT} environment,
 * as `pkg`'s trusted publisher, so publishing from CI needs no token. Needs npm 11.15 or later, and a maintainer's
 * 2FA-authenticated login, and the package must already exist on npm. `otp`
 * is the login's one-time password: npm's browser sign-in needs a terminal,
 * which a captured run is not, so the code is passed instead.
 */
export function trustPublisher(
  pkg: string,
  otp: string,
): Promise<TrustOutcome> {
  return NpmTasks.trust((s) =>
    s.github(`${NPM_SCOPE}/${pkg}`, TRUSTED_WORKFLOW).repo(TRUSTED_REPOSITORY)
      .environment(NPM_ENVIRONMENT).allowPublish().yes().otp(otp).noThrow()
  );
}

/** What {@link trustAll} reads of one `npm trust` run. */
export interface TrustOutcome {
  /** The exit code. */
  readonly code: number;
  /** What npm wrote to stderr, where it reports `EOTP`. */
  readonly stderr: string;
}

/**
 * Trust each of `packages` with `trust`, asking `ask` for a one-time password
 * first and again whenever npm rejects the current one (`EOTP`, an expired or
 * used code), retrying that package once with the new code. Returns the
 * packages that still failed. A code is reused across packages while npm
 * accepts it, so a run asks once per code lifetime, not once per package.
 */
export async function trustAll(
  packages: readonly string[],
  trust: (pkg: string, otp: string) => Promise<TrustOutcome>,
  ask: (message: string) => string | null,
): Promise<string[]> {
  const read = (message: string) => {
    const code = ask(message)?.trim();
    if (!code) throw new Error("npm trust needs a one-time password.");
    return code;
  };
  let otp = read("npm one-time password:");
  const failed: string[] = [];
  for (const pkg of packages) {
    let out = await trust(pkg, otp);
    if (out.code !== 0 && out.stderr.includes("EOTP")) {
      otp = read(
        `${NPM_SCOPE}/${pkg}: that code expired; next one-time password:`,
      );
      out = await trust(pkg, otp);
    }
    if (out.code === 0) {
      ConsoleTasks.success(`${NPM_SCOPE}/${pkg} trusts release.yml.`);
    } else failed.push(pkg);
  }
  return failed;
}
