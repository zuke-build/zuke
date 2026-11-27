// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Deno release the bootstrapping launchers install, and the SHA-256 of
 * each platform's release asset they verify it against.
 *
 * This is the one place the pin lives. The repository's own `./zuke` and
 * `zuke.ps1` are generated from the launcher template that reads it (see
 * `build/launchers.ts`), and `zuke setup` stamps the same template into every
 * project that opts into the bootstrap — so bumping Deno is a change here, a
 * `./zuke launcherSync`, and a commit, never a hand edit of a shell file.
 *
 * Bump the version and the checksums *together*: pull the new asset digests
 * from the release page (GitHub reports each asset's `digest`), or from
 * `gh release view <tag> --repo denoland/deno --json assets`, and cross-check
 * by downloading and hashing the artifact.
 *
 * @module
 */

/**
 * A Deno release asset's target triple, as it appears in the asset name
 * (`deno-<target>.zip`).
 */
export type DenoTarget =
  | "x86_64-unknown-linux-gnu"
  | "aarch64-unknown-linux-gnu"
  | "x86_64-apple-darwin"
  | "aarch64-apple-darwin"
  | "x86_64-pc-windows-msvc"
  | "aarch64-pc-windows-msvc";

/** The pinned Deno release and the checksum of each platform's asset. */
export interface DenoPin {
  /** The release version without its `v` prefix, e.g. `"2.8.3"`. */
  readonly version: string;
  /** Lowercase hex SHA-256 of `deno-<target>.zip` for each supported target. */
  readonly checksums: Readonly<Record<DenoTarget, string>>;
}

/* cspell:disable */

/**
 * The Deno release the launchers bootstrap, with its verified checksums: the
 * newest patch on Deno's 2.9 LTS line.
 */
export const DENO_PIN: DenoPin = {
  version: "2.9.8",
  checksums: {
    "x86_64-unknown-linux-gnu":
      "e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609",
    "aarch64-unknown-linux-gnu":
      "d49596c20b9788cf8f5d8ddf644103d4bde56ed239753f0bdb92ba9361d51905",
    "x86_64-apple-darwin":
      "4b2f5edd2639b7470f034238b321d7002d8dfb4726d8558f52c17afac370eb2c",
    "aarch64-apple-darwin":
      "9f0bf660393da2eaff044cdc7444cb08c73f235849b61d224d825a194ce7c98e",
    "x86_64-pc-windows-msvc":
      "cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf",
    "aarch64-pc-windows-msvc":
      "b413b92b735b50c198e8fe3b85af1aa50e29d5f72e229aab701d132286e14cef",
  },
};

/* cspell:enable */

/** The release tag the pin downloads, e.g. `v2.8.3`. */
export function denoReleaseTag(pin: DenoPin): string {
  return `v${pin.version}`;
}

/** The targets the POSIX launcher can bootstrap (Linux and macOS). */
export const POSIX_TARGETS: readonly DenoTarget[] = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
];

/** The targets the PowerShell launcher can bootstrap (Windows). */
export const WINDOWS_TARGETS: readonly DenoTarget[] = [
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
];
