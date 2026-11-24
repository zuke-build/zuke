// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: every engine conformance case, replayed through the `zuke`
 * binary the release ships, built from the workspace as a Node single
 * executable. The in-process suite proves the engine's behaviour under Deno;
 * this proves the same behaviour from the binary, where the engine runs on
 * Node: its subprocesses, its socket to the worker, its exit codes and its
 * death.
 *
 * Each case is one or more real runs of the binary from the case's
 * directory, whose `zuke.json` names the fake worker as the build's SDK.
 */

import { type ConformanceRunner, conformanceSuite } from "../_conformance.ts";
import {
  buildWorkspaceNodeBinary,
  MUST_HAVE_SEA_NODE,
  SEA_NODE,
} from "./_node_binary.ts";

/** The binary's name on this platform. */
const BINARY = Deno.build.os === "windows" ? "zuke.exe" : "zuke";

/** Where the binary is built, once, for every case in the file. */
const BIN_DIR = await Deno.makeTempDir({ prefix: "zuke-conformance-bin-" });

/** The binary every case runs, built on first use. */
let built: Promise<string> | undefined;

/** Build the workspace's binary, the first time a case asks for it. */
function binary(): Promise<string> {
  built ??= (async () => {
    const path = `${BIN_DIR}/${BINARY}`;
    await buildWorkspaceNodeBinary(path);
    return path;
  })();
  return built;
}

/** Run the binary as the cases need it: from the working directory, plain. */
async function runner(): Promise<ConformanceRunner> {
  const zuke = await binary();
  return {
    run: async (manifest, argv) => {
      const { code, stdout, stderr } = await new Deno.Command(zuke, {
        args: argv,
        cwd: Deno.cwd(),
        env: { ZUKE_FAKE_PLAN: JSON.stringify(manifest), ZUKE_PLAIN: "1" },
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
        // A regression that hangs must fail, not wedge the OS-matrix job.
        signal: AbortSignal.timeout(120_000),
      }).output();
      const text = new TextDecoder();
      return { code, out: text.decode(stdout), err: text.decode(stderr) };
    },
    engine: [zuke],
    engineEnv: { ZUKE_PLAIN: "1" },
  };
}

await conformanceSuite(
  "binary conformance",
  runner,
  SEA_NODE === undefined && !MUST_HAVE_SEA_NODE,
);

// Registered after every case, so it runs last.
Deno.test("binary conformance: remove the binary", async () => {
  // A Windows lock on the executable that just ran is not a failure.
  await Deno.remove(BIN_DIR, { recursive: true }).catch(() => {});
});
