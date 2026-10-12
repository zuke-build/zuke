// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What the `zuke` CLI's standalone release is made of, and when one is owed.
 *
 * Besides JSR, each `@zuke/cli` release ships as `deno compile` binaries on
 * its GitHub release (`cli-v<version>`) and through the Homebrew tap. This
 * module is the vocabulary every stage shares — the targets, the archive and
 * checksum names, where a published asset lives, the formula — so the
 * stages, which run as separate CI jobs on separate machines, cannot disagree
 * about any of it.
 *
 * Every stage is idempotent, and {@link planCliRelease} is what makes the
 * pipeline so: it asks what is already published, so a run that failed half
 * way is completed by the next push to master rather than redone or skipped.
 *
 * @module
 */

import type { DenoCompileTarget } from "@zuke/deno";
import {
  type FormulaArch,
  type FormulaOs,
  HomebrewTasks,
} from "@zuke/homebrew";
import { isNewerSemver } from "./semver.ts";

/** The repository the CLI is released from. */
export const CLI_REPO = "zuke-build/zuke";

/** The Homebrew tap the formula is published to, and the branch it reads. */
export const CLI_TAP = { repo: "zuke-build/homebrew-tap", branch: "main" };

/** The formula, executable and archive member name. */
export const CLI_BINARY = "zuke";

/** The checksum manifest published beside the archives. */
export const CHECKSUMS = "SHA256SUMS";

/** One platform a standalone binary is built for. */
export interface CliTarget {
  /** The `deno compile --target` triple, which also names the archive. */
  readonly triple: DenoCompileTarget;
  /** The formula's `on_<os>` block it belongs in. */
  readonly os: FormulaOs;
  /** The formula's `on_<arch>` block it belongs in. */
  readonly arch: FormulaArch;
}

/**
 * The platforms Homebrew runs on. Windows is not one, so it gets no binary
 * here: a Windows build would ship through another channel.
 */
export const CLI_TARGETS: readonly CliTarget[] = [
  { triple: "aarch64-apple-darwin", os: "macos", arch: "arm" },
  { triple: "x86_64-apple-darwin", os: "macos", arch: "intel" },
  { triple: "aarch64-unknown-linux-gnu", os: "linux", arch: "arm" },
  { triple: "x86_64-unknown-linux-gnu", os: "linux", arch: "intel" },
];

/** The macOS targets, which are signed and notarized before release. */
export const MACOS_TARGETS: readonly CliTarget[] = CLI_TARGETS.filter((t) =>
  t.os === "macos"
);

/**
 * The first CLI version that ships as a standalone binary.
 *
 * Earlier releases predate the binary's own support for being one: their
 * `zuke --version` names no install, and their `zuke upgrade` does not refuse
 * a Homebrew install, so it would put a second `zuke` beside it. Building
 * binaries for them would publish exactly that behaviour to the tap.
 */
export const FIRST_BINARY_VERSION = "1.14.0";

/** The release-please tag of a CLI version: `cli-v1.14.0`. */
export function cliReleaseTag(version: string): string {
  return `cli-v${version}`;
}

/** The archive a target's binary ships in: `zuke-1.14.0-aarch64-apple-darwin.tar.gz`. */
export function archiveName(version: string, target: CliTarget): string {
  return `${CLI_BINARY}-${version}-${target.triple}.tar.gz`;
}

/** The provenance attestation bundle published beside the archives. */
export function attestationName(version: string): string {
  return `${CLI_BINARY}-${version}.sigstore.json`;
}

/** Where a published asset of `version`'s release is downloaded from. */
export function releaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/${CLI_REPO}/releases/download/` +
    `${cliReleaseTag(version)}/${asset}`;
}

/** One line of a checksum manifest. */
export interface Checksum {
  /** The file's name, as published. */
  readonly name: string;
  /** Its SHA-256, 64 lowercase hex digits. */
  readonly sha256: string;
}

/**
 * A `SHA256SUMS` manifest in the format `sha256sum --check` reads: one
 * `<hex>  <name>` line per file, sorted by name so the bytes do not depend on
 * the order the archives were built in.
 */
export function checksumsText(sums: readonly Checksum[]): string {
  return [...sums]
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map((sum) => `${sum.sha256}  ${sum.name}\n`)
    .join("");
}

/** A line of a manifest: a digest, two spaces (or a space and `*`), a name. */
const CHECKSUM_LINE = /^([0-9a-f]{64}) [ *]([^\s/\\]+)$/;

/**
 * The digests a `SHA256SUMS` manifest lists, by file name.
 *
 * The manifest is fetched from the release, so it is read strictly: a line
 * that is not a digest and a plain file name, or a name listed twice, fails
 * rather than being skipped, since a formula built from a partial reading
 * would pin the wrong bytes.
 */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const match = CHECKSUM_LINE.exec(line);
    if (match === null) {
      throw new Error(
        `${CHECKSUMS}: not a checksum line: ${JSON.stringify(line)}`,
      );
    }
    const [, sha256, name] = match;
    if (sums.has(name)) {
      throw new Error(`${CHECKSUMS}: ${name} is listed twice`);
    }
    sums.set(name, sha256);
  }
  return sums;
}

/**
 * The Homebrew formula for `version`, pinning each archive to its digest in
 * `sums`.
 *
 * No `version` line: the archives sit under `releases/download/cli-v<version>/`
 * and carry the version in their names, which is where Homebrew reads it from,
 * and `brew audit` refuses an explicit line that repeats it.
 *
 * @throws {Error} when `sums` has no digest for one of the archives.
 */
export function cliFormula(
  version: string,
  sums: ReadonlyMap<string, string>,
): string {
  return HomebrewTasks.formula((s) => {
    let formula = s
      .name(CLI_BINARY)
      .description("Code-first, strongly-typed build automation for Deno")
      .homepage("https://zuke.build")
      .license("MIT")
      .install(CLI_BINARY)
      .test((t) => t.command("--version").expectVersion());
    for (const target of CLI_TARGETS) {
      const name = archiveName(version, target);
      const sha256 = sums.get(name);
      if (sha256 === undefined) {
        throw new Error(
          `${CHECKSUMS} for ${cliReleaseTag(version)} lists no ${name}`,
        );
      }
      formula = formula.binary((b) =>
        b.os(target.os).arch(target.arch)
          .url(releaseAssetUrl(version, name)).sha256(sha256)
      );
    }
    return formula;
  });
}

/** What {@link planCliRelease} asks about the published state. */
export interface CliReleaseProbe {
  /** Whether the GitHub release for the version exists yet. */
  releaseExists(): Promise<boolean>;
  /** Whether that release already carries its {@link CHECKSUMS}. */
  checksumsPublished(): Promise<boolean>;
  /** The tap's current formula source, or `undefined` when it has none. */
  tapFormula(): Promise<string | undefined>;
}

/** What a release run still has to do for a version. */
export interface CliReleasePlan {
  /** Build, sign and upload the binaries. */
  readonly build: boolean;
  /** Verify the formula and publish it to the tap. */
  readonly tap: boolean;
  /** Why, in a sentence for the log. */
  readonly reason: string;
}

/**
 * What is owed for `version`, from what is already published.
 *
 * - Older than {@link FIRST_BINARY_VERSION}: nothing, ever.
 * - No GitHub release yet: nothing. Release-please has not cut this version,
 *   and the binaries go on its release.
 * - A release without {@link CHECKSUMS}: everything. The manifest is uploaded
 *   last, so its absence means the binaries are missing or incomplete.
 * - Binaries published but the tap's formula does not point at them: only the
 *   tap, which a failed verify or publish leaves behind.
 * - Otherwise nothing: the run is a push that released no CLI.
 */
export async function planCliRelease(
  version: string,
  probe: CliReleaseProbe,
): Promise<CliReleasePlan> {
  const tag = cliReleaseTag(version);
  if (isNewerSemver(FIRST_BINARY_VERSION, version)) {
    return {
      build: false,
      tap: false,
      reason: `${tag} predates the first binary release ` +
        `(${FIRST_BINARY_VERSION}), so it ships from JSR only.`,
    };
  }
  if (!(await probe.releaseExists())) {
    return { build: false, tap: false, reason: `${tag} is not released yet.` };
  }
  if (!(await probe.checksumsPublished())) {
    return {
      build: true,
      tap: true,
      reason: `${tag} has no ${CHECKSUMS}, so its binaries are owed.`,
    };
  }
  const formula = await probe.tapFormula();
  if (formula === undefined || !formula.includes(`/${tag}/`)) {
    return {
      build: false,
      tap: true,
      reason: `${tag}'s binaries are published, but the tap's formula ` +
        "does not point at them yet.",
    };
  }
  return {
    build: false,
    tap: false,
    reason: `${tag} is published, and the tap's formula points at it.`,
  };
}

/** Where {@link httpCliReleaseProbe} sends its requests: `fetch`, or a fake. */
export type Fetch = typeof fetch;

/**
 * The {@link CliReleaseProbe} for the real release, asked over plain HTTPS
 * of github.com and the tap's raw file — no API token, so no rate limit
 * shared with the jobs that hold one.
 */
export function httpCliReleaseProbe(
  version: string,
  fetcher: Fetch = fetch,
): CliReleaseProbe {
  const tag = cliReleaseTag(version);
  // A HEAD without following the redirect: a published asset answers with a
  // redirect to its storage, a missing one with 404.
  const present = async (url: string): Promise<boolean> => {
    const response = await fetcher(url, { method: "HEAD", redirect: "manual" });
    await response.body?.cancel();
    if (response.status === 404) return false;
    if (response.status >= 200 && response.status < 400) return true;
    throw new Error(`HEAD ${url} answered ${response.status}`);
  };
  return {
    releaseExists: () =>
      present(`https://github.com/${CLI_REPO}/releases/tag/${tag}`),
    checksumsPublished: () => present(releaseAssetUrl(version, CHECKSUMS)),
    tapFormula: async () => {
      const url = `https://raw.githubusercontent.com/${CLI_TAP.repo}/` +
        `${CLI_TAP.branch}/Formula/${CLI_BINARY}.rb`;
      const response = await fetcher(url);
      if (response.status === 404) {
        await response.body?.cancel();
        return undefined;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`GET ${url} answered ${response.status}`);
      }
      return await response.text();
    },
  };
}

/** Fetch `version`'s published {@link CHECKSUMS} manifest. */
export async function fetchChecksums(
  version: string,
  fetcher: Fetch,
): Promise<Map<string, string>> {
  const url = releaseAssetUrl(version, CHECKSUMS);
  const response = await fetcher(url);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`GET ${url} answered ${response.status}`);
  }
  return parseChecksums(await response.text());
}
