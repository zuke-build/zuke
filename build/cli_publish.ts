// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Publishing a CLI release's binaries, verifying its formula, and updating
 * the Homebrew tap.
 *
 * The upload attaches everything to the version's draft release and then
 * publishes it. The three run as separate CI jobs, in that order, and each
 * reads what the one before it published rather than anything handed over in between: the
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
import {
  type GhReleaseEditSettings,
  type GhReleaseUploadSettings,
  GhTasks,
} from "@zuke/gh";
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
  windowsArchiveName,
} from "./cli_release.ts";

/** What {@link uploadCliRelease} needs to write to the release. */
export interface UploadOptions {
  /** The CLI version, whose `cli-v<version>` draft release receives the assets. */
  readonly version: string;
  /** The directory holding the archives and {@link CHECKSUMS}. */
  readonly dir: string;
  /** The provenance attestation bundle to publish beside them. */
  readonly attestation: string;
  /** The `gh release` commands to run; the real `gh` by default. */
  readonly gh?: ReleaseTools;
}

/** The `gh release` commands {@link uploadCliRelease} runs, injectable for tests. */
export interface ReleaseTools {
  /** Attach assets to a release (`gh release upload`). */
  upload(
    configure: (s: GhReleaseUploadSettings) => GhReleaseUploadSettings,
  ): Promise<unknown>;
  /** Edit a release (`gh release edit`). */
  edit(
    configure: (s: GhReleaseEditSettings) => GhReleaseEditSettings,
  ): Promise<unknown>;
}

/** The real {@link ReleaseTools}: `@zuke/gh`'s `GhTasks`, authenticated by `GITHUB_TOKEN`. */
export const GH_RELEASE: ReleaseTools = {
  upload: (configure) => GhTasks.releaseUpload(configure),
  edit: (configure) => GhTasks.releaseEdit(configure),
};

/**
 * Attach the archives, the attestation bundle and {@link CHECKSUMS} to the
 * version's draft release, then publish it.
 *
 * Publishing is what locks the release, so it comes last: a run that fails
 * before it leaves a draft the next run attaches to again, replacing what is
 * there (a retried run signs afresh, and the manifest must describe the
 * archives beside it). `gh` finds a draft by its tag, which the REST lookup
 * by tag does not. The release is published without moving the "Latest
 * release" pointer, which stays on the Marketplace action's release.
 */
export async function uploadCliRelease(options: UploadOptions): Promise<void> {
  const { version, dir, attestation, gh = GH_RELEASE } = options;
  const tag = cliReleaseTag(version);
  // gh names an asset after its file, so the bundle is copied to its name.
  const bundle = `${dir}/${attestationName(version)}`;
  await Deno.copyFile(attestation, bundle);
  const files = [
    ...CLI_TARGETS.map((target) => `${dir}/${archiveName(version, target)}`),
    `${dir}/${windowsArchiveName(version)}`,
    bundle,
    `${dir}/${CHECKSUMS}`,
  ];
  await gh.upload((s) => s.tag(tag).files(...files).clobber().repo(CLI_REPO));
  ConsoleTasks.info(`${tag}: attached ${files.length} assets.`);
  await gh.edit((s) =>
    s.tag(tag).flag("draft=false").flag("latest=false").repo(CLI_REPO)
  );
  ConsoleTasks.info(`${tag}: published.`);
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
