// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Node.js release the Node launchers bootstrap, and the SHA-256 of each
 * platform's official `nodejs.org` dist asset they verify it against. The one
 * place the pin lives, as {@link "./deno_pin.ts"} is for Deno: bump the version
 * and the checksums together, from `https://nodejs.org/dist/v<version>/SHASUMS256.txt`.
 *
 * @module
 */

/** A Node dist platform, as it appears in the asset name `node-v<version>-<platform>.<ext>`. */
export type NodePlatform =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "win-arm64"
  | "win-x64";

/** The pinned Node release and the checksum of each platform's asset. */
export interface NodePin {
  /** The release version without its `v` prefix, e.g. `"26.13.1"`. */
  readonly version: string;
  /** Lowercase hex SHA-256 of the dist asset for each supported platform. */
  readonly checksums: Readonly<Record<NodePlatform, string>>;
}

/* cspell:disable */

/** The Node release the launchers bootstrap (Node 26, Active LTS), with its verified checksums. */
export const NODE_PIN: NodePin = {
  version: "26.13.1",
  checksums: {
    "darwin-arm64":
      "aec2514ea1ceb2ba52455e9ec65986f6749a06dd759e5db2a72e6889668c9735",
    "darwin-x64":
      "82bb96078a24ca50b9c9a38f2379e6be6d87171fcd400fc14c8934b3bce96e2f",
    "linux-arm64":
      "80a330b35415382878df18d41afbd106ea89bfb3be0087d6608e289a14c5cc7d",
    "linux-x64":
      "518674de2b621728a5e4486f5fb3b7d2900bb3cc4aa97969edaa463db99f9778",
    "win-arm64":
      "181ebe431b90787113a9e4fc80d38ce86d37888a353a0386de44d2872e48cb97",
    "win-x64":
      "e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7",
  },
};

/* cspell:enable */

/** The platforms the POSIX launcher can bootstrap (`.tar.gz` assets). */
export const NODE_POSIX_PLATFORMS: readonly NodePlatform[] = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
];

/** The platforms the PowerShell launcher can bootstrap (`.zip` assets). */
export const NODE_WINDOWS_PLATFORMS: readonly NodePlatform[] = [
  "win-arm64",
  "win-x64",
];

/** Where the dist assets are downloaded from; the launchers append `v<version>/<asset>`. */
export const NODE_DIST_URL = "https://nodejs.org/dist";
