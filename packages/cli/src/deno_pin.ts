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

/** The Deno release the launchers bootstrap, with its verified checksums. */
export const DENO_PIN: DenoPin = {
  version: "2.8.3",
  checksums: {
    "x86_64-unknown-linux-gnu":
      "30455b845ffa6082209c3590269c910ad3b7efdf28c9879afd4006c47ae54197",
    "aarch64-unknown-linux-gnu":
      "d4589cc1ffcbf1995c92a0127d932aaf832ac70cfdcc6d5b7bf38043cf303575",
    "x86_64-apple-darwin":
      "4254ec12123cfcf88b87703d7acf092a1ea024bdf9be8dd3cd9d4474761cb74e",
    "aarch64-apple-darwin":
      "88b350be928fdba0e5d8142ff7c101a17133426371e3cf5ed0e0f74e62476f6c",
    "x86_64-pc-windows-msvc":
      "7fdd1f42e6b0855421ecf27bb406e2492ade1087c85e30ebf0deab6280ea743c",
    "aarch64-pc-windows-msvc":
      "243f478ac577ade1bbd980ecf510607a10ed8cc977b462083ada48e5f6580de1",
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
