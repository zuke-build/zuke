// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Publishing a CLI release's binaries, verifying its formula, and updating
 * the Homebrew tap.
 *
 * The three run as separate CI jobs, in that order, and each reads what the
 * one before it published rather than anything handed over in between: the
 * verify and tap stages fetch the release's own `SHA256SUMS`, so the formula
 * they check and publish pins exactly the bytes users download.
 *
 * @module
 */

import {
  type CodesignDisplay,
  type CodesignDisplaySettings,
  CodesignTasks,
  type CodesignVerifySettings,
} from "@zuke/apple";
import { ConsoleTasks } from "@zuke/console";
import { gunzip, untar } from "@zuke/core";
import { GhTasks } from "@zuke/gh";
import { HomebrewTasks, type HomebrewTasksApi } from "@zuke/homebrew";
import {
  archiveName,
  attestationName,
  CHECKSUMS,
  CLI_BINARY,
  CLI_REPO,
  CLI_TAP,
  CLI_TARGETS,
  cliFormula,
  cliReleaseTag,
  type Fetch,
  fetchChecksums,
  MACOS_TARGETS,
  releaseAssetUrl,
} from "./cli_release.ts";

/** What {@link uploadCliRelease} needs to write to the release. */
export interface UploadOptions {
  /** The CLI version, whose `cli-v<version>` release receives the assets. */
  readonly version: string;
  /** The directory holding the archives and {@link CHECKSUMS}. */
  readonly dir: string;
  /** The provenance attestation bundle to publish beside them. */
  readonly attestation: string;
  /** A token allowed to write the repository's releases. */
  readonly token: string;
  /** The transport for the GitHub API; the global `fetch` by default. */
  readonly fetch?: Fetch;
}

/**
 * Upload the archives and the attestation bundle to the release, then
 * {@link CHECKSUMS} last — its presence is what marks the binaries published
 * (`planCliRelease`), so a run that fails part way leaves them owed.
 *
 * An asset already there with different bytes is replaced: a retried run
 * signs afresh, and the manifest it uploads must describe the archives
 * beside it.
 *
 * @throws {GhApiError} when the release does not exist: with an explicit
 * tag, `uploadReleaseAsset` reports a missing release as the API's 404.
 */
export async function uploadCliRelease(options: UploadOptions): Promise<void> {
  const { version, dir, attestation, token, fetch: fetcher = fetch } = options;
  const uploads: Array<{ file: string; name: string }> = [
    ...CLI_TARGETS.map((target) => {
      const name = archiveName(version, target);
      return { file: `${dir}/${name}`, name };
    }),
    { file: attestation, name: attestationName(version) },
    { file: `${dir}/${CHECKSUMS}`, name: CHECKSUMS },
  ];
  for (const { file, name } of uploads) {
    const result = await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).name(name).tag(cliReleaseTag(version)).repo(CLI_REPO)
        .token(token).refresh().fetch(fetcher)
    );
    ConsoleTasks.info(`${name}: ${result.state}.`);
  }
}

/** Write `version`'s formula, from its published checksums, to `path`. */
export async function writeCliFormula(
  version: string,
  path: string,
  fetcher: Fetch,
): Promise<string> {
  const formula = cliFormula(version, await fetchChecksums(version, fetcher));
  await Deno.writeTextFile(path, formula);
  return formula;
}

/** The `codesign` checks {@link verifyMacSignature} runs, injectable for tests. */
export interface SignatureTools {
  /** Verify a binary's signature, strictly. */
  verify(
    configure: (s: CodesignVerifySettings) => CodesignVerifySettings,
  ): Promise<unknown>;
  /** Read who signed a binary. */
  display(
    configure: (s: CodesignDisplaySettings) => CodesignDisplaySettings,
  ): Promise<CodesignDisplay>;
}

/** The real {@link SignatureTools}: `@zuke/apple`'s `CodesignTasks`. */
export const CODESIGN: SignatureTools = {
  verify: (configure) => CodesignTasks.verify(configure),
  display: (configure) => CodesignTasks.display(configure),
};

/**
 * Check a published macOS archive's binary is signed with a Developer ID.
 *
 * Homebrew installs without the quarantine flag, so running the installed
 * binary never consults Gatekeeper; the signature is checked directly instead.
 */
export async function verifyMacSignature(
  version: string,
  fetcher: Fetch = fetch,
  codesign: SignatureTools = CODESIGN,
): Promise<void> {
  const scratch = await Deno.makeTempDir({ prefix: "zuke-signature-" });
  try {
    for (const target of MACOS_TARGETS) {
      const url = releaseAssetUrl(version, archiveName(version, target));
      const response = await fetcher(url);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`GET ${url} answered ${response.status}`);
      }
      const entries = untar(
        await gunzip(new Uint8Array(await response.arrayBuffer())),
      );
      const member = entries.find((entry) => entry.name === CLI_BINARY);
      if (member === undefined) {
        throw new Error(`${url} holds no ${CLI_BINARY}`);
      }
      const binary = `${scratch}/${target.triple}`;
      await Deno.writeFile(binary, member.data);
      await codesign.verify((s) => s.strict().verbose(2).file(binary));
      const display = await codesign.display((s) => s.verbose(4).file(binary));
      if (
        !display.authorities.some((a) =>
          a.startsWith("Developer ID Application:")
        )
      ) {
        throw new Error(
          `${target.triple}'s binary is not signed with a Developer ID ` +
            `(authorities: ${display.authorities.join(", ") || "none"}).`,
        );
      }
      ConsoleTasks.info(
        `${target.triple}: signed by ${display.authorities[0]}.`,
      );
    }
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}

/** What {@link verifyCliFormula} reaches outside the process. */
export interface VerifyHost {
  /** Installing, testing and removing the formula with `brew`. */
  readonly homebrew: Pick<HomebrewTasksApi, "verify">;
  /** Checking the published macOS binaries' signatures. */
  readonly signatures: (version: string) => Promise<void>;
  /** Where the checksums are fetched from. */
  readonly fetch: Fetch;
  /** The operating system, which decides whether signatures are checked. */
  readonly os: typeof Deno.build.os;
}

/** The real {@link VerifyHost}. */
export const defaultVerifyHost: VerifyHost = {
  homebrew: HomebrewTasks,
  signatures: (version) => verifyMacSignature(version),
  fetch,
  os: Deno.build.os,
};

/**
 * Install `version`'s formula with the real `brew`, run its test, and remove
 * it again; on macOS, also check the published binaries' signatures.
 */
export async function verifyCliFormula(
  version: string,
  path: string,
  host: VerifyHost = defaultVerifyHost,
): Promise<void> {
  await writeCliFormula(version, path, host.fetch);
  await host.homebrew.verify((s) => s.formulaFile(path).name(CLI_BINARY));
  if (host.os === "darwin") await host.signatures(version);
}

/** Commit `version`'s formula to the tap, unless it is already there. */
export async function publishCliFormula(
  version: string,
  token: string,
  fetcher: Fetch = fetch,
): Promise<void> {
  const formula = cliFormula(version, await fetchChecksums(version, fetcher));
  const result = await HomebrewTasks.publish((s) =>
    s.tap(CLI_TAP.repo).formula(CLI_BINARY, formula).token(token)
      .branch(CLI_TAP.branch).message(`zuke ${version}`).fetch(fetcher)
  );
  ConsoleTasks.info(
    `Formula/${CLI_BINARY}.rb on ${CLI_TAP.repo}: ${result.state}.`,
  );
}
