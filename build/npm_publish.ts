// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Publishing the compiled packages (`dist/npm/<name>`, see `npm_build.ts`) to
 * npm as `@zuke-build/<name>`, and registering each one's trusted publisher.
 */

import { ConsoleTasks } from "@zuke/console";
import { HttpError, httpJson, ProcessTasks } from "@zuke/core";
import { NpmTasks, NpmTrustSettings } from "@zuke/npm";
import { messageOf } from "../packages/core/src/internal.ts";
import { NPM_SCOPE } from "./npm_manifest.ts";
import { NPM_DIST } from "./npm_build.ts";
import { type ReleaseProbe, releaseSource, releaseTag } from "./npm_release.ts";
import type { PublishRegistry } from "./publish.ts";

/**
 * The GitHub Environment the npm publish job runs in. The trusted publisher is
 * bound to it, and a new package's one-off `NPM_TOKEN` lives in it, so only a
 * job in this environment (whose deployment branches are limited to `master`)
 * can publish.
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
 * release tag's source ({@link releaseSource}), so npm `X.Y.Z` is the source
 * JSR `X.Y.Z` has. A package changed since its release waits for its next one
 * (a package new to npm, until then); a missing tag fails that package and the
 * walk goes on. `git` is the seam to the tags.
 */
export function npmRegistry(git?: ReleaseProbe): PublishRegistry {
  return {
    name: "npm",
    packageName: (pkg) => `${NPM_SCOPE}/${pkg}`,
    isPublished: isPublishedToNpm,
    async held(pkg, version) {
      return await releaseSource(pkg, version, git) === "changed"
        ? `packages/${pkg} changed since ${
          releaseTag(pkg, version)
        }, so its next release publishes it to npm.`
        : null;
    },
    async publish(pkg, version) {
      // Checked again right before the upload, and only `same` passes: a
      // checkout changed since `held` looked must not reach npm either.
      const source = await releaseSource(pkg, version, git);
      if (source !== "same") {
        throw new Error(
          source === "untagged"
            ? `there is no tag ${releaseTag(pkg, version)} in this clone, so ` +
              `its source cannot be shown to be JSR's ${NPM_SCOPE}/${pkg}@${version}; ` +
              "fetch the tags and retry."
            : `packages/${pkg} changed since ${
              releaseTag(pkg, version)
            }; npm would get different source than JSR's ${NPM_SCOPE}/${pkg}@${version}.`,
        );
      }
      ConsoleTasks.info(`Publishing ${NPM_SCOPE}/${pkg}@${version} to npm...`);
      await publishToNpm(pkg);
    },
  };
}

/** What {@link trustAll} reads of one `npm trust` run. */
export interface TrustOutcome {
  /** npm's exit code. */
  readonly code: number;
  /** What npm wrote to stderr, where it names its error code. */
  readonly stderr: string;
}

/**
 * Register the release workflow, in the {@link NPM_ENVIRONMENT} environment,
 * as `pkg`'s trusted publisher, so publishing from CI needs no token. Needs
 * npm 11.15 or later, a maintainer's login, and the package already on npm.
 * npm asks for 2FA on every call, and it signs in through the browser (a
 * security key) or prompts for a code only when stdin and stdout are the
 * terminal, so those are inherited. Its stderr is read for the error code and
 * passed through as it arrives, so the maintainer still sees all of it.
 */
export async function trustPublisher(pkg: string): Promise<TrustOutcome> {
  const [command, ...args] = new NpmTrustSettings()
    .github(`${NPM_SCOPE}/${pkg}`, TRUSTED_WORKFLOW).repo(TRUSTED_REPOSITORY)
    .environment(NPM_ENVIRONMENT).allowPublish().yes().argv();
  const child = ProcessTasks.spawn(
    command,
    (s) => s.args(...args).stdin("inherit").stdout("inherit").stderr("piped"),
  );
  const decoder = new TextDecoder();
  let stderr = "";
  for await (const chunk of child.stderr) {
    await Deno.stderr.write(chunk);
    stderr += decoder.decode(chunk, { stream: true });
  }
  return { code: (await child.status).code, stderr };
}

/**
 * npm's answer when the package already trusts a publisher that matches:
 * `E409`, "a trusted publisher configuration ... already exists".
 */
function alreadyTrusted(outcome: TrustOutcome): boolean {
  return outcome.code !== 0 && /\bE409\b/.test(outcome.stderr);
}

/**
 * Trust each of `packages` with `trust`, and return those that failed. A
 * package that already trusts the workflow (npm's `E409`) is no failure: it
 * is reported as trusted already. Each failure goes to `report`; npm's own
 * error is already on the terminal above it. A call that cannot even start
 * (npm not found, a spawn error) fails its own package, and the rest still run.
 */
export async function trustAll(
  packages: readonly string[],
  trust: (pkg: string) => Promise<TrustOutcome>,
  report: (message: string) => void,
): Promise<string[]> {
  const failed: string[] = [];
  for (const pkg of packages) {
    let problem: string | null;
    try {
      const outcome = await trust(pkg);
      if (alreadyTrusted(outcome)) {
        ConsoleTasks.info(`${NPM_SCOPE}/${pkg} already trusts release.yml.`);
        continue;
      }
      problem = outcome.code === 0
        ? null
        : `npm trust exited with code ${outcome.code}`;
    } catch (error) {
      problem = messageOf(error);
    }
    if (problem === null) {
      ConsoleTasks.success(`${NPM_SCOPE}/${pkg} trusts release.yml.`);
    } else {
      report(`${NPM_SCOPE}/${pkg}: ${problem}.`);
      failed.push(pkg);
    }
  }
  return failed;
}
