// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: core's process seam under real Node. The unit tests run the
 * Node backend through Deno's `node:child_process`, which is not Node. What
 * Node itself does with a command, its arguments, its streams and a Windows
 * batch file is only known by running it, on each operating system:
 * {@link file://./fixtures/node_process_canary.mjs} does that, loading
 * `packages/core/src/process.ts` as TypeScript source.
 *
 * These tests need a real `node` on `PATH` that can run TypeScript, so they
 * are skipped where there is none. CI's OS matrix has one; the fast unit gate
 * never reaches this file (it is `*_e2e.ts`).
 */

import { fileURLToPath } from "node:url";
import { assertEquals } from "../../packages/core/tests/_assert.ts";

const CANARY = fileURLToPath(
  new URL("./fixtures/node_process_canary.mjs", import.meta.url),
);

/** The first Node that runs TypeScript source, behind the flag passed below. */
const MINIMUM = [22, 6];

/** The version of the `node` on `PATH`, or `null` when there is none. */
async function nodeVersion(): Promise<number[] | null> {
  try {
    const { success, stdout } = await new Deno.Command("node", {
      args: ["--version"],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!success) return null;
    return new TextDecoder().decode(stdout).trim().replace(/^v/, "").split(".")
      .map(Number);
  } catch {
    return null;
  }
}

const VERSION = await nodeVersion();
const USABLE = VERSION !== null &&
  (VERSION[0] > MINIMUM[0] ||
    (VERSION[0] === MINIMUM[0] && VERSION[1] >= MINIMUM[1]));

/**
 * On CI the skip is not allowed: every runner in the matrix ships Node, so a
 * missing or old one means the environment changed, and silently skipping
 * would retire this coverage without anyone noticing.
 */
const MUST_HAVE_NODE = Deno.env.get("CI") === "true";

Deno.test({
  name: "CI runs the Node process canary rather than skipping it",
  ignore: !MUST_HAVE_NODE,
  fn: () => {
    assertEquals(
      USABLE,
      true,
      `no node ${MINIMUM.join(".")} or later on PATH (found ${
        VERSION?.join(".") ?? "none"
      }): the Node process canary would have been skipped on a runner that ` +
        "is supposed to provide one.",
    );
  },
});

Deno.test({
  name:
    "the process seam starts, feeds, reads and ends children under real Node",
  ignore: !USABLE,
  fn: async () => {
    const { code, stdout, stderr } = await new Deno.Command("node", {
      // Needed before 22.18, accepted after it.
      args: ["--experimental-strip-types", "--no-warnings", CANARY],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    assertEquals(
      { code, stderr: decode(stderr) },
      { code: 0, stderr: "" },
    );
    assertEquals(decode(stdout).includes("node process canary ok"), true);
  },
});
