// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Packaging the compiled `zuke` binaries into their release archives.
 *
 * Each target's binary goes into its own `.tar.gz`, as the single member
 * `zuke` with mode `0755` — so it runs as extracted, by hand or by Homebrew —
 * and a `SHA256SUMS` manifest lists every archive. Archives are written with
 * core's `tar`, whose fixed mtime and ownership make the bytes depend only on
 * the binary: rebuilding the same binary reproduces the same digest.
 *
 * @module
 */

import { gzip, sha256Hex, tar } from "@zuke/core";
import {
  archiveName,
  type Checksum,
  CHECKSUMS,
  checksumsText,
  CLI_BINARY,
  CLI_TARGETS,
} from "./cli_release.ts";

/** Where the compiled binary of `triple` sits under a binaries directory. */
export function binaryPath(binDir: string, triple: string): string {
  return `${binDir}/${triple}/${CLI_BINARY}`;
}

/**
 * Pack each target's binary from `binDir` into an archive in `outDir`, then
 * write the {@link CHECKSUMS} manifest beside them, and return the checksums.
 *
 * @throws {Error} when a target's binary is missing: a release with one
 * platform short would publish a formula that cannot install there.
 */
export async function packageCliArchives(
  version: string,
  binDir: string,
  outDir: string,
): Promise<Checksum[]> {
  await Deno.mkdir(outDir, { recursive: true });
  const sums: Checksum[] = [];
  for (const target of CLI_TARGETS) {
    const source = binaryPath(binDir, target.triple);
    let data: Uint8Array;
    try {
      data = await Deno.readFile(source);
    } catch (error) {
      throw new Error(
        `no ${target.triple} binary to package at ${source}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const archive = await gzip(tar([{ name: CLI_BINARY, data, mode: 0o755 }]));
    const name = archiveName(version, target);
    await Deno.writeFile(`${outDir}/${name}`, archive);
    sums.push({ name, sha256: await sha256Hex(archive) });
  }
  await Deno.writeTextFile(`${outDir}/${CHECKSUMS}`, checksumsText(sums));
  return sums;
}
