// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The standalone `zuke` release a project another SDK hosts runs on, and the
 * SHA-256 of each platform's archive its launchers verify the download
 * against.
 *
 * Such a project has no Deno code, so its launchers bootstrap no Deno: they
 * download the pinned `zuke` binary from its GitHub release, which carries
 * the engine and every tool wrapper. The pin is read once, when `zuke setup`
 * scaffolds the launchers or `zuke upgrade --engine` moves them: the
 * archives' digests from the release's own `SHA256SUMS`, and the engine the
 * release carries from `packages/engine/deno.json` at its tag. A published
 * release is immutable, so the digests the launchers hold stay the release's.
 *
 * @module
 */

import { isRecord } from "./records.ts";
import { VERSION_PATTERN } from "./version_report.ts";

/** The repository the `zuke` releases are published from. */
export const BINARY_REPO = "zuke-build/zuke";

/** Where the launchers download a release's archives from, before the tag. */
export const BINARY_RELEASES_URL =
  `https://github.com/${BINARY_REPO}/releases/download`;

/** Where to get `zuke`, as the launchers and refusals name it. */
export const BINARY_INSTALL_DOCS =
  "https://github.com/zuke-build/zuke/blob/master/docs/install.md";

/** The checksum manifest each release publishes beside its archives. */
export const BINARY_CHECKSUMS = "SHA256SUMS";

/** A platform a `zuke` release ships a binary for, as its archive names it. */
export type BinaryTarget =
  | "aarch64-apple-darwin"
  | "x86_64-apple-darwin"
  | "aarch64-unknown-linux-gnu"
  | "x86_64-unknown-linux-gnu"
  | "x86_64-pc-windows-msvc";

/** The targets the bash launcher can download (Linux and macOS), each a `.tar.gz`. */
export const BINARY_POSIX_TARGETS: readonly BinaryTarget[] = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-gnu",
];

/** The target the PowerShell launcher downloads, a `.zip` holding `zuke.exe`. */
export const BINARY_WINDOWS_TARGET: BinaryTarget = "x86_64-pc-windows-msvc";

/** The pinned `zuke` release, the engine inside it, and each archive's digest. */
export interface BinaryPin {
  /** The release, without the tag's `cli-v` prefix, e.g. `"2.4.0"`. */
  readonly version: string;
  /** The `@zuke/engine` release compiled into it. */
  readonly engine: string;
  /** Lowercase hex SHA-256 of each target's archive. */
  readonly checksums: Readonly<Record<BinaryTarget, string>>;
}

/** The release tag of a `zuke` version: `cli-v2.4.0`. */
export function binaryReleaseTag(version: string): string {
  return `cli-v${version}`;
}

/** The archive a target's binary ships in: `zuke-2.4.0-x86_64-unknown-linux-gnu.tar.gz`. */
export function binaryArchiveName(
  version: string,
  target: BinaryTarget,
): string {
  const extension = target === BINARY_WINDOWS_TARGET ? "zip" : "tar.gz";
  return `zuke-${version}-${target}.${extension}`;
}

/** What resolving a pin reaches over the network, injectable for tests. */
export type PinFetch = (url: string) => Promise<Response>;

/** A line of a manifest: a digest, two spaces (or a space and `*`), a name. */
const CHECKSUM_LINE = /^([0-9a-f]{64}) [ *]([^\s/\\]+)$/;

/**
 * The digests a `SHA256SUMS` manifest lists, by file name.
 *
 * Strict, since what it reads is pinned into launchers and formulas: a line
 * that is not a digest and a name, or a name listed twice, is refused rather
 * than skipped or overwritten.
 *
 * @throws {Error} naming the first line that is not one, or a repeated name.
 */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const match = CHECKSUM_LINE.exec(line);
    if (match === null) {
      throw new Error(
        `${BINARY_CHECKSUMS}: not a checksum line: ${JSON.stringify(line)}`,
      );
    }
    const [, sha256, name] = match;
    if (sums.has(name)) {
      throw new Error(`${BINARY_CHECKSUMS}: ${name} is listed twice`);
    }
    sums.set(name, sha256);
  }
  return sums;
}

/** The text at `url`, or a message naming what was missing. */
async function fetchText(
  fetch: PinFetch,
  url: string,
  what: string,
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `${what} could not be read from ${url} (HTTP ${response.status})`,
    );
  }
  return await response.text();
}

/**
 * Resolve the pin of `zuke` `version`: every target's archive digest from
 * the release's `SHA256SUMS`, and its engine from the tag's
 * `packages/engine/deno.json`.
 * @throws {Error} when the release has no published binaries, lists no digest
 * for a target, or its engine version cannot be read.
 */
export async function resolveBinaryPin(
  version: string,
  fetch: PinFetch,
): Promise<BinaryPin> {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`"${version}" is not a zuke release such as 2.4.0`);
  }
  const tag = binaryReleaseTag(version);
  const sums = parseChecksums(
    await fetchText(
      fetch,
      `${BINARY_RELEASES_URL}/${tag}/${BINARY_CHECKSUMS}`,
      `zuke ${version}'s published binaries`,
    ),
  );
  const digest = (target: BinaryTarget): string => {
    const name = binaryArchiveName(version, target);
    const sha256 = sums.get(name);
    if (sha256 === undefined) {
      throw new Error(
        `zuke ${version}'s ${BINARY_CHECKSUMS} lists no digest for ${name}`,
      );
    }
    return sha256;
  };
  const checksums: Record<BinaryTarget, string> = {
    "aarch64-apple-darwin": digest("aarch64-apple-darwin"),
    "x86_64-apple-darwin": digest("x86_64-apple-darwin"),
    "aarch64-unknown-linux-gnu": digest("aarch64-unknown-linux-gnu"),
    "x86_64-unknown-linux-gnu": digest("x86_64-unknown-linux-gnu"),
    "x86_64-pc-windows-msvc": digest("x86_64-pc-windows-msvc"),
  };
  const config: unknown = JSON.parse(
    await fetchText(
      fetch,
      `https://raw.githubusercontent.com/${BINARY_REPO}/${tag}/packages/engine/deno.json`,
      `the @zuke/engine release inside zuke ${version}`,
    ),
  );
  const engine = isRecord(config) ? config.version : undefined;
  if (typeof engine !== "string" || !VERSION_PATTERN.test(engine)) {
    throw new Error(
      `zuke ${version}'s packages/engine/deno.json names no engine version`,
    );
  }
  return { version, engine, checksums };
}
