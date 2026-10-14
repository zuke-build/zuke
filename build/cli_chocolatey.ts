// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Publishing the CLI's Windows binary through Chocolatey.
 *
 * Like the tap stages, both run as their own CI jobs and read what the
 * upload published, not anything handed over in between: the package pins
 * the Windows zip's digest from the release's own `SHA256SUMS`, so what is
 * verified and pushed installs exactly the bytes on the release.
 *
 * The executable is not Authenticode-signed yet (#793); the package's
 * description says so, beside the checks that do apply.
 *
 * @module
 */

import {
  type ChocolateyPackage,
  ChocolateyTasks,
  type ChocolateyTasksApi,
} from "@zuke/chocolatey";
import { ConsoleTasks } from "@zuke/console";
import {
  CHECKSUMS,
  CHOCOLATEY_ID,
  CLI_BINARY,
  CLI_REPO,
  cliReleaseTag,
  type Fetch,
  fetchChecksums,
  releaseAssetUrl,
  windowsArchiveName,
} from "./cli_release.ts";

/** What the package's description tells a Chocolatey user. */
const DESCRIPTION = [
  "Zuke is code-first, strongly-typed build automation for Deno and",
  "TypeScript: a build is a class, its targets are typed fields, and the",
  "`zuke` command scaffolds a project, migrates an existing one, and runs",
  "its build. This package installs the standalone `zuke` executable, so no",
  "Deno is needed up front.",
  "",
  "The executable is not Authenticode-signed yet, so Windows SmartScreen may",
  "warn the first time it runs. This package pins the release zip's SHA-256,",
  "and the zip carries a build-provenance attestation that",
  "`gh attestation verify` checks.",
].join("\n");

/**
 * The Chocolatey package for `version`, pinning the Windows zip to its digest
 * in `sums`.
 *
 * @throws {Error} when `sums` has no digest for the Windows zip.
 */
export function cliChocolateyPackage(
  version: string,
  sums: ReadonlyMap<string, string>,
): ChocolateyPackage {
  const name = windowsArchiveName(version);
  const sha256 = sums.get(name);
  if (sha256 === undefined) {
    throw new Error(
      `${CHECKSUMS} for ${cliReleaseTag(version)} lists no ${name}`,
    );
  }
  const repo = `https://github.com/${CLI_REPO}`;
  return ChocolateyTasks.package((s) =>
    s.id(CHOCOLATEY_ID).version(version).title("Zuke")
      .authors("The Zuke contributors")
      .projectUrl("https://zuke.build")
      .licenseUrl(`${repo}/blob/master/LICENSE`)
      .packageSourceUrl(repo)
      .bugTrackerUrl(`${repo}/issues`)
      .tags("zuke", "build", "automation", "deno", "typescript", "cli")
      .summary("Code-first, strongly-typed build automation for Deno")
      .description(DESCRIPTION)
      .releaseNotes(`${repo}/releases/tag/${cliReleaseTag(version)}`)
      .url64bit(releaseAssetUrl(version, name))
      .checksum64(sha256)
  );
}

/** Install `version`'s package with the real `choco`, run it, and remove it. */
export async function verifyCliChocolatey(
  version: string,
  fetcher: Fetch = fetch,
  chocolatey: Pick<ChocolateyTasksApi, "verify"> = ChocolateyTasks,
): Promise<void> {
  const pkg = cliChocolateyPackage(
    version,
    await fetchChecksums(version, fetcher),
  );
  await chocolatey.verify((s) =>
    s.package(pkg).binary(CLI_BINARY).command("--version").expectVersion()
  );
}

/** Push `version`'s package to the Chocolatey community repository. */
export async function publishCliChocolatey(
  version: string,
  apiKey: string,
  fetcher: Fetch = fetch,
  chocolatey: Pick<ChocolateyTasksApi, "publish"> = ChocolateyTasks,
): Promise<void> {
  const pkg = cliChocolateyPackage(
    version,
    await fetchChecksums(version, fetcher),
  );
  const result = await chocolatey.publish((s) => s.package(pkg).apiKey(apiKey));
  ConsoleTasks.info(`${result.nupkg}: pushed to ${result.source}.`);
}
