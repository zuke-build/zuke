// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `zuke` binaries: the bundle `build/cli_compile.ts` writes, turned into
 * one single executable application per release target.
 *
 * Each target's executable is that target's official Node release with the
 * bundle injected (`node --build-sea`, with the config's `executable`), so one
 * Linux runner builds all five. The Node is the release the project launchers pin
 * (`packages/cli/src/node_pin.ts`), downloaded from nodejs.org and checked
 * against that pin's SHA-256 before anything is taken from it. Injection
 * leaves a macOS binary's signature invalid; the release signs it afterwards
 * (`build/cli_sign.ts`).
 *
 * @module
 */

import { CodesignTasks } from "@zuke/apple";
import {
  type AbsolutePath,
  absolutePath,
  FileTasks,
  gunzip,
  ProcessTasks,
  sha256Hex,
  untar,
  unzip,
} from "@zuke/core";
import {
  NODE_DIST_URL,
  NODE_PIN,
  type NodePin,
  type NodePlatform,
} from "../packages/cli/src/node_pin.ts";
import { binaryPath } from "./cli_package.ts";
import { CLI_TARGETS, type Fetch, WINDOWS_TRIPLE } from "./cli_release.ts";

/** Every release target, and the Node platform whose release it is built on. */
export const NODE_TARGETS: ReadonlyArray<
  { readonly triple: string; readonly platform: NodePlatform }
> = [
  ...CLI_TARGETS.map((t) => ({
    triple: t.triple,
    platform: nodePlatformOf(t.os, t.arch),
  })),
  { triple: WINDOWS_TRIPLE, platform: "win-x64" },
];

/** The Node platform of a release target's operating system and architecture. */
function nodePlatformOf(
  os: "macos" | "linux",
  arch: "arm" | "intel",
): NodePlatform {
  const cpu = arch === "arm" ? "arm64" : "x64";
  return os === "macos" ? `darwin-${cpu}` : `linux-${cpu}`;
}

/** Where `platform`'s release of `pin` is, its checksum, and its `node` inside it. */
export interface NodeAsset {
  /** The release archive's download URL. */
  readonly url: string;
  /** Its pinned SHA-256, lowercase hex. */
  readonly sha256: string;
  /** The path of the `node` executable inside the archive. */
  readonly member: string;
  /** Whether the archive is a zip (Windows) rather than a `.tar.gz`. */
  readonly zip: boolean;
}

/** {@link NodeAsset} of `platform`'s release of `pin`. */
export function nodeAsset(
  platform: NodePlatform,
  pin: NodePin = NODE_PIN,
): NodeAsset {
  const root = `node-v${pin.version}-${platform}`;
  const zip = platform.startsWith("win-");
  return {
    url: `${NODE_DIST_URL}/v${pin.version}/${root}.${zip ? "zip" : "tar.gz"}`,
    sha256: pin.checksums[platform],
    member: zip ? `${root}/node.exe` : `${root}/bin/node`,
    zip,
  };
}

/**
 * Download `asset`, refuse it unless its SHA-256 is the pinned one, and return
 * the `node` executable inside it.
 *
 * @throws {Error} naming the URL on a failed download, a checksum mismatch,
 * or an archive with no `node` where the release puts it.
 */
export async function fetchNodeBinary(
  asset: NodeAsset,
  fetcher: Fetch = fetch,
): Promise<Uint8Array> {
  const response = await fetcher(asset.url);
  if (!response.ok) {
    throw new Error(`${asset.url}: HTTP ${response.status}`);
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  const actual = await sha256Hex(archive);
  if (actual !== asset.sha256) {
    throw new Error(
      `${asset.url}: SHA-256 ${actual}, not the pinned ${asset.sha256}`,
    );
  }
  const entries = asset.zip
    ? await unzip(archive)
    : untar(await gunzip(archive));
  const node = entries.find((e) => e.name === asset.member);
  if (node === undefined) {
    throw new Error(`${asset.url} holds no ${asset.member}`);
  }
  return node.data;
}

/** The `node --build-sea` configuration that injects `main` into `executable`, written to `output`. */
export function seaConfig(
  main: string,
  executable: string,
  output: string,
): string {
  return `${
    JSON.stringify(
      {
        main,
        mainFormat: "module",
        executable,
        output,
        disableExperimentalSEAWarning: true,
      },
      null,
      2,
    )
  }\n`;
}

/** Builds one single executable from the config at the given path. */
export type BuildSea = (config: string) => Promise<void>;

/** The real {@link BuildSea}: `node --build-sea` with the `node` on `PATH`, Node 25 or newer. */
export const NODE_BUILD_SEA: BuildSea = async (config) => {
  const { code } = await ProcessTasks.run(
    "node",
    (s) => s.args("--build-sea", config),
  );
  if (code !== 0) throw new Error(`node --build-sea ${config} exited ${code}`);
};

/**
 * Build the single executable of every target in {@link NODE_TARGETS} from
 * `bundle`, into `outDir` laid out as the Deno binaries are
 * (`<triple>/zuke`, `zuke.exe` on Windows).
 */
export async function compileNodeCli(
  bundle: AbsolutePath,
  outDir: AbsolutePath,
  fetcher: Fetch = fetch,
  buildSea: BuildSea = NODE_BUILD_SEA,
  pin: NodePin = NODE_PIN,
): Promise<void> {
  const scratch = absolutePath(
    await FileTasks.makeTempDirectory((s) => s.prefix("zuke-node-sea-")),
  );
  try {
    for (const { triple, platform } of NODE_TARGETS) {
      const asset = nodeAsset(platform, pin);
      const node = scratch(asset.zip ? `${platform}.exe` : platform);
      // Executable: --build-sea gives the output the mode of what it copies.
      await FileTasks.writeBytes(
        node.path,
        await fetchNodeBinary(asset, fetcher),
        (s) => s.mode(0o755),
      );
      const output = absolutePath(binaryPath(outDir.path, triple));
      await FileTasks.createDirectory(output.parent().path);
      const config = scratch(`${platform}.json`);
      await FileTasks.writeText(
        config.path,
        seaConfig(bundle.path, node.path, output.path),
      );
      await buildSea(config.path);
    }
  } finally {
    await FileTasks.remove(scratch, { recursive: true });
  }
}

/**
 * Ad-hoc sign the macOS executable at `path`, so this Mac will start it:
 * injection leaves its signature invalid, and macOS kills an arm64 binary
 * without a valid one. Only for running it here; the release signs it for
 * real.
 */
export async function adHocSign(path: string): Promise<void> {
  await CodesignTasks.sign((s) => s.identity("-").force().file(path));
}

/**
 * The release target this machine runs, from its operating system and
 * architecture as core's `RuntimeTasks` names them, or `undefined` when no
 * target is built for it.
 */
export function hostTriple(os: string, arch: string): string | undefined {
  const family = os === "darwin"
    ? "-apple-darwin"
    : os === "linux"
    ? "-unknown-linux-gnu"
    : os === "windows"
    ? "-pc-windows-msvc"
    : undefined;
  if (family === undefined) return undefined;
  return NODE_TARGETS.find((t) => t.triple === `${arch}${family}`)?.triple;
}
