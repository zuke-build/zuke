// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: `compileNodeCli` with the real `node --build-sea`, and the
 * host's single executable run. The download is the one step faked: the host
 * target's "release" is an archive of the `node` on `PATH`, pinned by its own
 * checksum, so the configuration, the injection and the executable it makes
 * are all real. The other targets get a stand-in archive and no injection;
 * only the host's executable can run here.
 *
 * Needs Node 25 or newer on `PATH` (the integration workflow installs the
 * pinned one) and skips without it; on CI the skip is refused.
 */

import { absolutePath, gzip, sha256Hex, tar, zip } from "@zuke/core";
import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  adHocSign,
  type BuildSea,
  compileNodeCli,
  hostTriple,
  NODE_BUILD_SEA,
  NODE_TARGETS,
  nodeAsset,
} from "../../build/cli_node_compile.ts";
import { binaryPath } from "../../build/cli_package.ts";
import {
  NODE_PIN,
  type NodePin,
  type NodePlatform,
} from "../../packages/cli/src/node_pin.ts";

/** The `node` on `PATH`, when it is one that has `--build-sea`. */
async function seaNode(): Promise<string | undefined> {
  try {
    const out = await new Deno.Command("node", {
      args: ["-p", "process.versions.node + ' ' + process.execPath"],
      stdout: "piped",
      stderr: "null",
    }).output();
    const [version, ...path] = new TextDecoder().decode(out.stdout).trim()
      .split(" ");
    return out.success && Number(version.split(".")[0]) >= 25
      ? path.join(" ")
      : undefined;
  } catch {
    return undefined;
  }
}

const NODE = await seaNode();
const HOST = hostTriple(Deno.build.os, Deno.build.arch);

Deno.test({
  name: "CI runs the Node single executable test rather than skipping it",
  ignore: Deno.env.get("CI") !== "true",
  fn: () => {
    assertEquals(
      NODE !== undefined,
      true,
      "no Node 25 or newer on PATH: the single executable e2e test would " +
        "have been skipped on a runner that is supposed to provide one.",
    );
  },
});

Deno.test({
  name:
    "compileNodeCli injects the bundle into the host's Node, and the executable runs it",
  ignore: NODE === undefined || HOST === undefined,
  async fn() {
    const host = NODE_TARGETS.find((t) => t.triple === HOST);
    if (NODE === undefined || host === undefined) return;
    const root = absolutePath(await Deno.makeTempDir());
    try {
      const bundle = root("zuke.mjs");
      await Deno.writeTextFile(
        bundle.path,
        'import process from "node:process";\n' +
          'console.log(`sea ${process.argv.slice(2).join(" ")}`);\n',
      );
      const node = await Deno.readFile(NODE);
      const archives = new Map<string, Uint8Array>();
      const checksums: Record<NodePlatform, string> = { ...NODE_PIN.checksums };
      for (const { platform } of NODE_TARGETS) {
        const asset = nodeAsset(platform);
        // Only the host's archive holds a real Node; the rest only unpack.
        const data = platform === host.platform ? node : new Uint8Array(1);
        const archive = asset.zip
          ? await zip([{ name: asset.member, data }])
          : await gzip(tar([{ name: asset.member, data }]));
        archives.set(asset.url, archive);
        checksums[platform] = await sha256Hex(archive);
      }
      const pin: NodePin = { ...NODE_PIN, checksums };
      const fetcher = (url: string | URL | Request) => {
        const archive = archives.get(String(url));
        return Promise.resolve(
          archive === undefined
            ? new Response(null, { status: 404 })
            : new Response(new Uint8Array(archive)),
        );
      };
      // The whole file name: "darwin-x64.json" ends with "win-x64.json".
      const buildSea: BuildSea = (config) =>
        config.split(/[\\/]/).at(-1) === `${host.platform}.json`
          ? NODE_BUILD_SEA(config)
          : Promise.resolve();
      const out = root("bin");
      await compileNodeCli(bundle, out, fetcher, buildSea, pin);

      const exe = binaryPath(out.path, host.triple);
      if (Deno.build.os === "darwin") await adHocSign(exe);
      const run = await new Deno.Command(exe, {
        args: ["--version", "x"],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const text = new TextDecoder();
      assertEquals(
        text.decode(run.stdout).trim(),
        "sea --version x",
        text.decode(run.stderr),
      );
    } finally {
      await Deno.remove(root.path, { recursive: true });
    }
  },
});
