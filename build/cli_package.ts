// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Packaging the compiled `zuke` binaries into their release archives.
 *
 * Each Homebrew target's binary goes into its own `.tar.gz`, as the single
 * member `zuke` with mode `0755` — so it runs as extracted, by hand or by
 * Homebrew — and the Windows binary into a `.zip` as `zuke.exe`, which is
 * what Chocolatey unpacks. A `SHA256SUMS` manifest lists every archive.
 * Archives are written with core's `tar` and `zip`, whose fixed timestamps
 * make the bytes depend only on the binary: rebuilding the same binary
 * reproduces the same digest.
 *
 * @module
 */

import { gzip, sha256Hex, tar, zip } from "@zuke/core";
import {
  archiveName,
  type Checksum,
  CHECKSUMS,
  checksumsText,
  CLI_BINARY,
  CLI_TARGETS,
  WINDOWS_TRIPLE,
  windowsArchiveName,
} from "./cli_release.ts";

/** The binary's file name for `triple`: `zuke`, or `zuke.exe` on Windows. */
export function binaryName(triple: string): string {
  return triple === WINDOWS_TRIPLE ? `${CLI_BINARY}.exe` : CLI_BINARY;
}

/** Where the compiled binary of `triple` sits under a binaries directory. */
export function binaryPath(binDir: string, triple: string): string {
  return `${binDir}/${triple}/${binaryName(triple)}`;
}

/**
 * The compiled binary of `triple`.
 *
 * @throws {Error} when it is missing: a release with one platform short
 * would publish a package that cannot install there.
 */
async function readBinary(binDir: string, triple: string): Promise<Uint8Array> {
  const source = binaryPath(binDir, triple);
  try {
    return await Deno.readFile(source);
  } catch (error) {
    throw new Error(
      `no ${triple} binary to package at ${source}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Pack each target's binary from `binDir` into an archive in `outDir`, then
 * write the {@link CHECKSUMS} manifest beside them, and return the checksums.
 *
 * @throws {Error} when a target's binary is missing.
 */
export async function packageCliArchives(
  version: string,
  binDir: string,
  outDir: string,
): Promise<Checksum[]> {
  await Deno.mkdir(outDir, { recursive: true });
  const sums: Checksum[] = [];
  const write = async (name: string, archive: Uint8Array) => {
    await Deno.writeFile(`${outDir}/${name}`, archive);
    sums.push({ name, sha256: await sha256Hex(archive) });
  };
  for (const target of CLI_TARGETS) {
    const data = await readBinary(binDir, target.triple);
    await write(
      archiveName(version, target),
      await gzip(tar([{ name: CLI_BINARY, data, mode: 0o755 }])),
    );
  }
  await write(
    windowsArchiveName(version),
    await zip([{
      name: binaryName(WINDOWS_TRIPLE),
      data: await readBinary(binDir, WINDOWS_TRIPLE),
    }]),
  );
  await Deno.writeTextFile(`${outDir}/${CHECKSUMS}`, checksumsText(sums));
  return sums;
}
