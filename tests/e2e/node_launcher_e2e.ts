// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: the bash Node launcher, run for real against a fake `node` and a
 * fake `npm` on `PATH` (no network, no real Node). It must run the build with
 * the node it finds, and install dependencies with `npm ci --ignore-scripts`
 * when `package-lock.json` is newer than the last successful install. Its bootstrap is run
 * too, against a fake `curl` that serves a local tarball: the download is
 * verified, unpacked and cached, a cached Node is reused without a download,
 * a checksum mismatch installs nothing, and a failing npm stops the run.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { nodeLauncherBash } from "../../packages/cli/src/node_launcher.ts";
import { NODE_PIN } from "../../packages/cli/src/node_pin.ts";

/** Writes an executable shell script. */
async function script(path: string, body: string): Promise<void> {
  await Deno.writeTextFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

Deno.test({
  name: "the node launcher runs the build and npm ci with the node it finds",
  ignore: Deno.build.os === "windows",
  async fn() {
    const root = await Deno.makeTempDir();
    try {
      const bin = `${root}/bin`;
      await Deno.mkdir(bin);
      await Deno.mkdir(`${root}/project/node_modules`, { recursive: true });
      const log = `${root}/log`;
      await script(
        `${bin}/node`,
        `if [ "$1" = "--version" ]; then echo v${NODE_PIN.version}; exit 0; fi\necho "node $*" >> "${log}"`,
      );
      await script(`${bin}/npm`, `echo "npm $*" >> "${log}"`);
      await Deno.writeTextFile(`${root}/project/build.ts`, "");
      await Deno.writeTextFile(`${root}/project/package.json`, "{}");
      // cspell:ignore mktemp
      // node_modules exists, but no install has succeeded yet.
      await Deno.writeTextFile(`${root}/project/package-lock.json`, "{}");
      const launcher = `${root}/project/zuke`;
      await Deno.writeTextFile(
        launcher,
        nodeLauncherBash({ buildFile: "build.ts" }),
        { mode: 0o755 },
      );

      const run = async () => {
        const { code, stderr } = await new Deno.Command(launcher, {
          args: ["lint", "--plain"],
          env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root },
          clearEnv: true,
          stdout: "null",
          stderr: "piped",
        }).output();
        assertEquals(code, 0, new TextDecoder().decode(stderr));
      };
      await run();
      // The second run finds the install it recorded and skips npm.
      await run();
      assertEquals(
        (await Deno.readTextFile(log)).trim().split("\n"),
        [
          "npm ci --ignore-scripts",
          "node build.ts lint --plain",
          "node build.ts lint --plain",
        ],
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

/**
 * A PATH of the real tools the launcher uses, with no `node`, `npm` or `curl`
 * on it, so a test decides exactly which of those exist.
 */
async function toolsDir(root: string): Promise<string> {
  const dir = `${root}/tools`;
  await Deno.mkdir(dir);
  const tools = [
    "bash",
    "env",
    "dirname",
    "basename",
    "sed",
    "sleep",
    "mktemp",
    "mkdir",
    "tar",
    "gzip",
    "rm",
    "mv",
    "awk",
    "sha256sum",
    "shasum",
    "uname",
    "cat",
    "chmod",
  ];
  // From the system directories rather than whatever PATH says, so a wrapper
  // earlier on the PATH of the machine running the tests does not stand in.
  const system = ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"];
  for (const tool of tools) {
    for (const base of system) {
      const path = `${base}/${tool}`;
      if (await Deno.stat(path).then(() => true, () => false)) {
        await Deno.symlink(path, `${dir}/${tool}`);
        break;
      }
    }
  }
  return dir;
}

/** The SHA-256 of `path`, in lowercase hex. */
async function sha256(path: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(path),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A project with the launcher, and a Node release tarball holding a fake
 * `bin/node` that logs its arguments, served by a fake `curl` that copies it to
 * the `-o` path and logs that it ran. Returns what a run needs.
 */
async function bootstrapWorld(root: string) {
  const bin = `${root}/bin`;
  const log = `${root}/log`;
  await Deno.mkdir(bin);
  await Deno.mkdir(`${root}/release/node-v9.9.9/bin`, { recursive: true });
  await script(
    `${root}/release/node-v9.9.9/bin/node`,
    `echo "node $*" >> "${log}"`,
  );
  const tarball = `${root}/node.tar.gz`;
  const packed = await new Deno.Command("tar", {
    args: ["-czf", tarball, "-C", `${root}/release`, "node-v9.9.9"],
  }).output();
  assertEquals(packed.success, true);
  await script(
    `${bin}/curl`,
    `out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && { out="$2"; shift; }; shift; done\necho curl >> "${log}"\ncat "${tarball}" > "$out"`,
  );
  await Deno.mkdir(`${root}/project`);
  await Deno.writeTextFile(`${root}/project/build.ts`, "");
  const launcher = `${root}/project/zuke`;
  await Deno.writeTextFile(
    launcher,
    nodeLauncherBash({ buildFile: "build.ts" }),
    { mode: 0o755 },
  );
  const path = `${bin}:${await toolsDir(root)}`;
  const run = async (env: Record<string, string>) => {
    const out = await new Deno.Command(`${root}/tools/bash`, {
      args: [launcher, "ci"],
      env: { PATH: path, HOME: root, ...env },
      clearEnv: true,
      stdout: "null",
      stderr: "piped",
    }).output();
    return { code: out.code, stderr: new TextDecoder().decode(out.stderr) };
  };
  const logged = async () =>
    (await Deno.readTextFile(log).catch(() => "")).trim().split("\n")
      .filter((l) => l !== "");
  return { root, bin, tarball, run, logged, sha: await sha256(tarball) };
}

Deno.test({
  name:
    "the node launcher downloads, verifies and caches a Node, then reuses it",
  ignore: Deno.build.os === "windows",
  async fn() {
    const root = await Deno.makeTempDir();
    try {
      const w = await bootstrapWorld(root);
      const pinned = { NODE_VERSION: "9.9.9", NODE_SHA256: w.sha };
      const first = await w.run(pinned);
      assertEquals(first.code, 0, first.stderr);
      assertEquals(await w.logged(), ["curl", "node build.ts ci"]);
      // Installed whole into the cache, with no staging directory left over.
      const cache = `${root}/.zuke/node`;
      assertEquals(
        (await Array.fromAsync(Deno.readDir(cache))).map((e) => e.name),
        ["v9.9.9"],
      );
      // The next run takes the cached Node and downloads nothing.
      await Deno.remove(`${w.bin}/curl`);
      const second = await w.run(pinned);
      assertEquals(second.code, 0, second.stderr);
      assertEquals(await w.logged(), [
        "curl",
        "node build.ts ci",
        "node build.ts ci",
      ]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "the node launcher installs nothing when the download's checksum is wrong",
  ignore: Deno.build.os === "windows",
  async fn() {
    const root = await Deno.makeTempDir();
    try {
      const w = await bootstrapWorld(root);
      const out = await w.run({
        NODE_VERSION: "9.9.9",
        NODE_SHA256: "0".repeat(64),
      });
      assertEquals(out.code, 1);
      assertEquals(out.stderr.includes("checksum mismatch"), true, out.stderr);
      assertEquals(await w.logged(), ["curl"]);
      // Neither the release nor a staging directory reached the cache.
      const entries = await Array.fromAsync(
        Deno.readDir(`${root}/.zuke/node`),
      ).catch(() => []);
      assertEquals(entries, []);
      // An override with no checksum is refused before any download.
      const unpinned = await w.run({ NODE_VERSION: "9.9.9" });
      assertEquals(unpinned.code, 1);
      assertEquals(unpinned.stderr.includes("NODE_SHA256"), true);
      assertEquals(await w.logged(), ["curl"]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "the node launcher stops when npm fails, never runs the build, and retries the install",
  ignore: Deno.build.os === "windows",
  async fn() {
    const root = await Deno.makeTempDir();
    try {
      const w = await bootstrapWorld(root);
      // npm fails part-way, after it has created node_modules.
      await script(
        `${w.bin}/npm`,
        `echo npm >> "${root}/log"; mkdir -p node_modules; exit 3`,
      );
      await Deno.writeTextFile(`${root}/project/package.json`, "{}");
      await Deno.writeTextFile(`${root}/project/package-lock.json`, "{}");
      const pinned = { NODE_VERSION: "9.9.9", NODE_SHA256: w.sha };
      const out = await w.run(pinned);
      assertEquals(out.code, 3, out.stderr);
      assertEquals(await w.logged(), ["curl", "npm"]);
      // The next run installs again rather than trusting that node_modules.
      await script(`${w.bin}/npm`, `echo npm >> "${root}/log"`);
      const retry = await w.run(pinned);
      assertEquals(retry.code, 0, retry.stderr);
      assertEquals(await w.logged(), [
        "curl",
        "npm",
        "npm",
        "node build.ts ci",
      ]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "the node launcher uses a Node a concurrent launcher published first, and leaves no copy of its own",
  ignore: Deno.build.os === "windows",
  async fn() {
    const root = await Deno.makeTempDir();
    try {
      const w = await bootstrapWorld(root);
      // The other launcher's Node lands in the cache while this one downloads.
      await Deno.mkdir(`${root}/winner/bin`, { recursive: true });
      await script(
        `${root}/winner/bin/node`,
        `echo "winner $*" >> "${root}/log"`,
      );
      await script(
        `${w.bin}/curl`,
        `out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && { out="$2"; shift; }; shift; done\necho curl >> "${root}/log"\nmkdir -p "${root}/.zuke/node"\nmv "${root}/winner" "${root}/.zuke/node/v9.9.9"\ncat "${w.tarball}" > "$out"`,
      );
      const out = await w.run({ NODE_VERSION: "9.9.9", NODE_SHA256: w.sha });
      assertEquals(out.code, 0, out.stderr);
      assertEquals(await w.logged(), ["curl", "winner build.ts ci"]);
      const names = async (dir: string) =>
        (await Array.fromAsync(Deno.readDir(dir))).map((e) => e.name);
      assertEquals(await names(`${root}/.zuke/node`), ["v9.9.9"]);
      assertEquals(await names(`${root}/.zuke/node/v9.9.9`), ["bin"]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "the node launcher never deletes what is already at the cache path, and says what to remove",
  ignore: Deno.build.os === "windows",
  async fn() {
    const root = await Deno.makeTempDir();
    try {
      const w = await bootstrapWorld(root);
      // A directory that is not a Node, which this run must not delete.
      await Deno.mkdir(`${root}/.zuke/node/v9.9.9`, { recursive: true });
      await Deno.writeTextFile(`${root}/.zuke/node/v9.9.9/keep`, "");
      const out = await w.run({ NODE_VERSION: "9.9.9", NODE_SHA256: w.sha });
      assertEquals(out.code, 1, out.stderr);
      assertEquals(out.stderr.includes("remove it and run again"), true);
      assertEquals(await w.logged(), ["curl"]);
      assertEquals(
        (await Array.fromAsync(Deno.readDir(`${root}/.zuke/node/v9.9.9`)))
          .map((e) => e.name),
        ["keep"],
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
