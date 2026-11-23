// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Building the Node `zuke` binary from the workspace, for the e2e tests that
 * run it: `deno bundle` turns the entry into one ES module, resolving
 * `@zuke/*` to the workspace members, and `node --build-sea` injects it into
 * the `node` on `PATH`. No package is fetched, so it is this checkout's code
 * that runs, as `deno compile` makes it for the Deno binary.
 */

import { binaryEntry } from "../../build/cli_binary.ts";
import { localVersion } from "../../build/packages.ts";
import {
  adHocSign,
  NODE_BUILD_SEA,
  seaConfig,
} from "../../build/cli_node_compile.ts";

/** The `node` on `PATH`, when it is one that has `--build-sea` (25 or newer). */
export async function seaNode(): Promise<string | undefined> {
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

/** The `node` with `--build-sea` on `PATH`, if any, found once. */
export const SEA_NODE = await seaNode();

/** Whether this is CI, where a missing Node is a broken runner, not a skip. */
export const MUST_HAVE_SEA_NODE = Deno.env.get("CI") === "true";

/**
 * Bundle the entry at `entry` (inside the checkout, so the workspace resolves
 * it) and inject it into `node`, writing the executable to `binary`: ad-hoc
 * signed on macOS, which kills an arm64 binary whose signature injection
 * broke.
 */
export async function buildNodeBinary(
  entry: string,
  binary: string,
  node: string,
): Promise<void> {
  const bundle = `${binary}.mjs`;
  const { code, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--no-lock", "--quiet", "--output", bundle, entry],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    throw new Error(`deno bundle failed: ${new TextDecoder().decode(stderr)}`);
  }
  const config = `${binary}.sea.json`;
  await Deno.writeTextFile(config, seaConfig(bundle, node, binary));
  await NODE_BUILD_SEA(config);
  if (Deno.build.os === "darwin") await adHocSign(binary);
}

/**
 * The entry the release compiles, for the workspace's CLI, engine and `deno`
 * wrapper in place of their JSR releases.
 */
async function workspaceEntry(): Promise<string> {
  return binaryEntry({
    cli: "@zuke/cli",
    engine: "@zuke/engine",
    engineVersion: await localVersion("engine"),
    core: "@zuke/core",
    coreVersion: await localVersion("core"),
    wrappers: [{
      name: "deno",
      version: await localVersion("deno"),
      specifier: "@zuke/deno",
    }],
  });
}

/**
 * Build the Node binary of {@link workspaceEntry} at `binary`, writing the
 * entry inside the checkout, where the workspace resolves `@zuke/*` to its
 * members, and removing it after.
 */
export async function buildWorkspaceNodeBinary(binary: string): Promise<void> {
  const source = await Deno.makeTempDir({
    dir: Deno.cwd(),
    prefix: ".zuke-e2e-entry-",
  });
  try {
    await Deno.writeTextFile(`${source}/zuke.ts`, await workspaceEntry());
    await buildNodeBinary(`${source}/zuke.ts`, binary, SEA_NODE ?? "node");
  } finally {
    await Deno.remove(source, { recursive: true });
  }
}
