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
import { dig } from "./npm_json.ts";
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
  /** What npm wrote to stdout, when it was read. */
  readonly stdout: string;
  /** What npm wrote to stderr, where it names its error code. */
  readonly stderr: string;
}

/**
 * Run `npm` with `args`: stdin always the terminal, which npm's 2FA reads,
 * stdout too unless `readStdout`, and stderr read. npm signs in (a security
 * key, through the browser, or a code) only when stdin and stdout are a
 * terminal, and writes those prompts to stdout, so stderr can be read without
 * hiding any.
 */
async function npm(args: string[], readStdout: boolean): Promise<TrustOutcome> {
  const [command, ...rest] = args;
  const out = await ProcessTasks.run(
    command,
    (s) =>
      s.args(...rest).stdin("inherit").stdout(readStdout ? "piped" : "inherit")
        .stderr("piped"),
  );
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return { code: out.code, stdout: text(out.stdout), stderr: text(out.stderr) };
}

/**
 * Register the release workflow, in the {@link NPM_ENVIRONMENT} environment,
 * as `pkg`'s trusted publisher, so publishing from CI needs no token. Needs
 * npm 11.15 or later, a maintainer's login, and the package already on npm;
 * npm asks for 2FA on every call.
 */
export function trustPublisher(pkg: string): Promise<TrustOutcome> {
  return npm(
    new NpmTrustSettings()
      .github(`${NPM_SCOPE}/${pkg}`, TRUSTED_WORKFLOW).repo(TRUSTED_REPOSITORY)
      .environment(NPM_ENVIRONMENT).allowPublish().yes().argv(),
    false,
  );
}

/** `pkg`'s trusted publishers, as `npm trust list --json` prints them. */
export function listPublishers(pkg: string): Promise<TrustOutcome> {
  return npm(
    new NpmTrustSettings().list(`${NPM_SCOPE}/${pkg}`).json().argv(),
    true,
  );
}

/**
 * The JSON values in `text`, one after another: `npm trust list --json`
 * prints one object per publisher, not an array. Text that is not JSON is
 * skipped a character at a time.
 */
export function jsonValues(text: string): unknown[] {
  const values: unknown[] = [];
  let start = text.indexOf("{");
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = start; i < text.length && end === -1; i++) {
      const c = text[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) end = i;
    }
    if (end === -1) break;
    try {
      values.push(JSON.parse(text.slice(start, end + 1)));
      start = text.indexOf("{", end + 1);
    } catch {
      start = text.indexOf("{", start + 1);
    }
  }
  return values;
}

/** Whether `listed` (`npm trust list --json` output) names this repository's release workflow. */
export function trustsRelease(listed: string): boolean {
  return jsonValues(listed).some((p) =>
    dig(p, "type") === "github" && dig(p, "file") === TRUSTED_WORKFLOW &&
    dig(p, "repository") === TRUSTED_REPOSITORY &&
    dig(p, "environment") === NPM_ENVIRONMENT
  );
}

/** npm's `E409`: the package already has a trusted publisher, not said which. */
function conflict(outcome: TrustOutcome): boolean {
  return outcome.code !== 0 && /\bE409\b/.test(outcome.stderr);
}

/** npm's `npm error …` lines in `stderr`, for a failure's report. */
function npmErrors(stderr: string): string[] {
  return stderr.split("\n").map((l) => l.trim())
    .filter((l) => l.startsWith("npm error"));
}

/** What {@link trustAll} runs: `npm trust github` and `npm trust list`. */
export interface TrustNpm {
  /** Make `release.yml` `pkg`'s trusted publisher. */
  trust(pkg: string): Promise<TrustOutcome>;
  /** List `pkg`'s trusted publishers as JSON. */
  list(pkg: string): Promise<TrustOutcome>;
}

/**
 * Why `pkg` does not trust the release workflow after `npm` tried, or `null`
 * when it does. An `E409` (a publisher already there) counts only when
 * `npm trust list` shows it is this repository's `release.yml` in the
 * {@link NPM_ENVIRONMENT} environment.
 */
async function trustProblem(
  pkg: string,
  npm: TrustNpm,
): Promise<string | null> {
  const outcome = await npm.trust(pkg);
  if (outcome.code === 0) return null;
  if (!conflict(outcome)) {
    return [
      `npm trust exited with code ${outcome.code}`,
      ...npmErrors(
        outcome.stderr,
      ),
    ].join("; ");
  }
  const listed = await npm.list(pkg);
  if (listed.code !== 0) {
    return [
      `it has a trusted publisher, and npm trust list exited with code ` +
      `${listed.code}, so it is not known to be ${TRUSTED_WORKFLOW}`,
      // With --json, npm reports its error as JSON on stdout.
      ...jsonValues(listed.stdout).map((v) => dig(v, "error", "summary"))
        .filter((m) => typeof m === "string"),
      ...npmErrors(listed.stderr),
    ].join("; ");
  }
  return trustsRelease(listed.stdout)
    ? null
    : `it has a trusted publisher other than ${TRUSTED_REPOSITORY}'s ` +
      `${TRUSTED_WORKFLOW} in the ${NPM_ENVIRONMENT} environment; npm trust ` +
      `list ${NPM_SCOPE}/${pkg} shows it`;
}

/**
 * Trust each of `packages` through `npm`, and return those that failed, each
 * given to `report` with why. A package that already has a trusted publisher
 * passes only when that publisher is the release workflow. A call that cannot
 * even start (npm not found, a spawn error) fails its own package, and the
 * rest still run.
 */
export async function trustAll(
  packages: readonly string[],
  npm: TrustNpm,
  report: (message: string) => void,
): Promise<string[]> {
  const failed: string[] = [];
  for (const pkg of packages) {
    let problem: string | null;
    try {
      problem = await trustProblem(pkg, npm);
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
