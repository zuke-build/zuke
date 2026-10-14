// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What the `zuke` CLI's standalone release is made of, and when one is owed.
 *
 * Besides JSR, each `@zuke/cli` release ships as `deno compile` binaries on
 * its GitHub release (`cli-v<version>`), through the Homebrew tap, and, for
 * Windows, through Chocolatey. This
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
 * The platforms Homebrew runs on. Windows is not one: its binary is
 * {@link WINDOWS_TRIPLE}, shipped as a zip through Chocolatey.
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

/** The Windows target, whose `zuke.exe` ships in a zip for Chocolatey. */
export const WINDOWS_TRIPLE: DenoCompileTarget = "x86_64-pc-windows-msvc";

/** The Chocolatey package id the Windows binary is published under. */
export const CHOCOLATEY_ID = "zuke";

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

/** The archive the Windows binary ships in: `zuke-1.15.0-x86_64-pc-windows-msvc.zip`. */
export function windowsArchiveName(version: string): string {
  return `${CLI_BINARY}-${version}-${WINDOWS_TRIPLE}.zip`;
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
  /** Whether that release carries the Windows zip, which older ones lack. */
  windowsArchivePublished(): Promise<boolean>;
  /** Whether Chocolatey has the version, approved or still in moderation. */
  chocolateyPublished(): Promise<boolean>;
}

/** What a release run still has to do for a version. */
export interface CliReleasePlan {
  /** Build, sign and upload the binaries. */
  readonly build: boolean;
  /** Verify the formula and publish it to the tap. */
  readonly tap: boolean;
  /** Verify the Chocolatey package and push it. */
  readonly chocolatey: boolean;
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
 * - Binaries published, with the Windows zip, but Chocolatey lacks the
 *   version: the Chocolatey package, which a failed verify or push leaves
 *   behind. A release without the zip predates the Windows binary.
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
      chocolatey: false,
      reason: `${tag} predates the first binary release ` +
        `(${FIRST_BINARY_VERSION}), so it ships from JSR only.`,
    };
  }
  if (!(await probe.releaseExists())) {
    return {
      build: false,
      tap: false,
      chocolatey: false,
      reason: `${tag} is not released yet.`,
    };
  }
  if (!(await probe.checksumsPublished())) {
    return {
      build: true,
      tap: true,
      chocolatey: true,
      reason: `${tag} has no ${CHECKSUMS}, so its binaries are owed.`,
    };
  }
  const formula = await probe.tapFormula();
  const chocolatey = await probe.windowsArchivePublished() &&
    !(await chocolateyHas(probe));
  const also = chocolatey ? " Its Chocolatey package is owed." : "";
  if (formula === undefined || !formula.includes(`/${tag}/`)) {
    return {
      build: false,
      tap: true,
      chocolatey,
      reason: `${tag}'s binaries are published, but the tap's formula ` +
        `does not point at them yet.${also}`,
    };
  }
  return {
    build: false,
    tap: false,
    chocolatey,
    reason: `${tag} is published, and the tap's formula points at it.${also}`,
  };
}

/**
 * Whether Chocolatey has the version. A Chocolatey that cannot be asked (a
 * challenge, a rate limit, an outage) reads as "no": the package's own jobs
 * then fail visibly, while the tap, planned beside it, is not held up.
 */
async function chocolateyHas(probe: CliReleaseProbe): Promise<boolean> {
  try {
    return await probe.chocolateyPublished();
  } catch (error) {
    console.warn(
      `Could not ask Chocolatey whether it has the version, so the package ` +
        `is planned: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
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
    windowsArchivePublished: () =>
      present(releaseAssetUrl(version, windowsArchiveName(version))),
    // The package page answers for a version in moderation too, so a pushed
    // package is not pushed again while it waits for approval.
    chocolateyPublished: () =>
      present(
        `https://community.chocolatey.org/packages/${CHOCOLATEY_ID}/${version}`,
      ),
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
