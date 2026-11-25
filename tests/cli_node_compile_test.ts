// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the Node-built binaries: which Node release each target is built
 * on, the archive it is taken from and refused unless it matches the pin, the
 * `--build-sea` configuration, and the build over every target with the
 * download and the injection faked.
 */

import { test } from "./_testing.ts";
import { assertEquals, assertRejects } from "./_assert.ts";
import {
  absolutePath,
  FileTasks,
  gzip,
  RuntimeTasks,
  sha256Hex,
  tar,
  zip,
} from "@zuke/core";
import {
  compileNodeCli,
  fetchNodeBinary,
  hostTriple,
  NODE_TARGETS,
  type NodeAsset,
  nodeAsset,
  seaConfig,
} from "../build/cli_node_compile.ts";
import { CLI_TARGETS, WINDOWS_TRIPLE } from "../build/cli_release.ts";
import {
  NODE_PIN,
  NODE_POSIX_PLATFORMS,
  NODE_WINDOWS_PLATFORMS,
  type NodePin,
} from "../packages/cli/src/node_pin.ts";

const encoder = new TextEncoder();

test("every release target is built on the Node release of its own platform", () => {
  assertEquals(
    NODE_TARGETS.map((t) => t.triple),
    [...CLI_TARGETS.map((t) => t.triple), WINDOWS_TRIPLE],
  );
  assertEquals(NODE_TARGETS.map((t) => t.platform), [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "win-x64",
  ]);
  assertEquals(hostTriple("linux", "x86_64"), "x86_64-unknown-linux-gnu");
  assertEquals(hostTriple("darwin", "aarch64"), "aarch64-apple-darwin");
  assertEquals(hostTriple("windows", "x86_64"), WINDOWS_TRIPLE);
  // No binary is built for these.
  assertEquals(hostTriple("windows", "aarch64"), undefined);
  assertEquals(hostTriple("freebsd", "x86_64"), undefined);
});

test("nodeAsset names the pinned release archive, its checksum and its node", () => {
  const linux = nodeAsset("linux-x64");
  assertEquals(
    linux.url,
    `https://nodejs.org/dist/v${NODE_PIN.version}/node-v${NODE_PIN.version}-linux-x64.tar.gz`,
  );
  assertEquals(linux.sha256, NODE_PIN.checksums["linux-x64"]);
  assertEquals(linux.member, `node-v${NODE_PIN.version}-linux-x64/bin/node`);
  assertEquals(linux.zip, false);
  const windows = nodeAsset("win-x64");
  assertEquals(windows.url.endsWith("-win-x64.zip"), true);
  assertEquals(windows.member, `node-v${NODE_PIN.version}-win-x64/node.exe`);
  assertEquals(windows.zip, true);
});

/** A fetch that answers `url` with `body`, and 404 anything else. */
function serving(url: string, body: Uint8Array) {
  return (input: string | URL | Request): Promise<Response> =>
    Promise.resolve(
      String(input) === url
        ? new Response(new Uint8Array(body))
        : new Response("missing", { status: 404 }),
    );
}

test("fetchNodeBinary takes node out of a release that matches its pin, from a tarball or a zip", async () => {
  const node = encoder.encode("node binary");
  const tarball = await gzip(tar([{ name: "r/bin/node", data: node }]));
  const posix: NodeAsset = {
    url: "https://x/node.tar.gz",
    sha256: await sha256Hex(tarball),
    member: "r/bin/node",
    zip: false,
  };
  assertEquals(await fetchNodeBinary(posix, serving(posix.url, tarball)), node);
  const archive = await zip([{ name: "r/node.exe", data: node }]);
  const windows: NodeAsset = {
    url: "https://x/node.zip",
    sha256: await sha256Hex(archive),
    member: "r/node.exe",
    zip: true,
  };
  assertEquals(
    await fetchNodeBinary(windows, serving(windows.url, archive)),
    node,
  );
});

test("fetchNodeBinary refuses a failed download, a checksum mismatch and a release with no node", async () => {
  const tarball = await gzip(
    tar([{ name: "r/bin/other", data: encoder.encode("x") }]),
  );
  const asset: NodeAsset = {
    url: "https://x/node.tar.gz",
    sha256: await sha256Hex(tarball),
    member: "r/bin/node",
    zip: false,
  };
  await assertRejects(
    () => fetchNodeBinary(asset, serving("https://elsewhere", tarball)),
    Error,
    "HTTP 404",
  );
  await assertRejects(
    () =>
      fetchNodeBinary(
        { ...asset, sha256: "0".repeat(64) },
        serving(asset.url, tarball),
      ),
    Error,
    "not the pinned",
  );
  await assertRejects(
    () => fetchNodeBinary(asset, serving(asset.url, tarball)),
    Error,
    "holds no r/bin/node",
  );
});

test("seaConfig injects an ES module bundle into the given Node", () => {
  const config = JSON.parse(seaConfig("/b/zuke.mjs", "/n/node", "/o/zuke"));
  assertEquals(config, {
    main: "/b/zuke.mjs",
    mainFormat: "module",
    executable: "/n/node",
    output: "/o/zuke",
    disableExperimentalSEAWarning: true,
  });
});

test("compileNodeCli builds every target from its own verified Node, laid out as the Deno binaries are", async () => {
  const dir = await FileTasks.makeTempDirectory((s) =>
    s.prefix("zuke-node-compile-")
  );
  try {
    // One small release per platform, pinned by its own checksum.
    const bodies = new Map<string, Uint8Array>();
    const checksums = { ...NODE_PIN.checksums };
    for (
      const platform of [...NODE_POSIX_PLATFORMS, ...NODE_WINDOWS_PLATFORMS]
    ) {
      const asset = nodeAsset(platform);
      const data = encoder.encode(`node for ${platform}`);
      const body = asset.zip
        ? await zip([{ name: asset.member, data }])
        : await gzip(tar([{ name: asset.member, data }]));
      bodies.set(asset.url, body);
      checksums[platform] = await sha256Hex(body);
    }
    const pin: NodePin = { version: NODE_PIN.version, checksums };
    const fetcher = (input: string | URL | Request) =>
      Promise.resolve(
        new Response(new Uint8Array(bodies.get(String(input)) ?? [])),
      );
    // The fake injection writes what it was given, as --build-sea would.
    const configs: { executable: string; output: string }[] = [];
    const buildSea = async (path: string) => {
      const config = JSON.parse(await FileTasks.readText(path));
      configs.push(config);
      const node = await FileTasks.readText(config.executable);
      await FileTasks.writeText(config.output, `${node} + ${config.main}`);
      if (RuntimeTasks.os() !== "windows") {
        const mode = (await FileTasks.stat(config.executable)).mode ?? 0;
        assertEquals(mode & 0o111, 0o111);
      }
    };
    const bundle = absolutePath(dir, "zuke.mjs");
    await compileNodeCli(
      bundle,
      absolutePath(dir, "bin"),
      fetcher,
      buildSea,
      pin,
    );
    assertEquals(configs.length, NODE_TARGETS.length);
    for (const { triple, platform } of NODE_TARGETS) {
      const name = triple === WINDOWS_TRIPLE ? "zuke.exe" : "zuke";
      assertEquals(
        await FileTasks.readText(`${dir}/bin/${triple}/${name}`),
        `node for ${platform} + ${bundle.path}`,
      );
    }
    // The downloaded Nodes went with the scratch directory.
    for (const { executable } of configs) {
      assertEquals(await FileTasks.stat(executable).catch(() => null), null);
    }
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
});
