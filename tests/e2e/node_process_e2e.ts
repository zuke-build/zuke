// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: core's process seam and its standard streams under real Node.
 * The unit tests run the Node code through Deno's `node:` modules, which are
 * not Node. What Node itself does with a command, its arguments, its streams
 * and a Windows batch file, and with output written to a pipe just before it
 * exits, is only known by running it, on each operating system:
 * {@link file://./fixtures/node_process_canary.mjs} and
 * {@link file://./fixtures/node_stdio_canary.mjs} do that, loading core's
 * TypeScript source.
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
const RUNTIME_CANARY = fileURLToPath(
  new URL("./fixtures/node_runtime_canary.mjs", import.meta.url),
);
/** Where core's source is, as the URL the runtime canary imports from. */
const CORE_SOURCE = new URL("../../packages/core/src/", import.meta.url).href;
const STDIO_CANARY = fileURLToPath(
  new URL("./fixtures/node_stdio_canary.mjs", import.meta.url),
);

/** The arguments that make `node` run the TypeScript a fixture loads. */
// Needed before 22.18, accepted after it.
const RUN_TYPESCRIPT = ["--experimental-strip-types", "--no-warnings"];

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

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
      args: [...RUN_TYPESCRIPT, CANARY],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(
      { code, stderr: decode(stderr) },
      { code: 0, stderr: "" },
    );
    assertEquals(decode(stdout).includes("node process canary ok"), true);
  },
});

Deno.test({
  name: "output written just before exit reaches a slow reader whole",
  ignore: !USABLE,
  fn: async () => {
    const child = new Deno.Command("node", {
      args: [...RUN_TYPESCRIPT, STDIO_CANARY, "flood"],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    // Nothing reads the pipe yet, so Node has most of the output queued when
    // the canary asks to exit.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { code, stdout, stderr } = await child.output();
    assertEquals(
      { code, stdout: stdout.length, stderr: decode(stderr) },
      { code: 3, stdout: 32 * 64 * 1024, stderr: "to stderr\n" },
    );
  },
});

Deno.test({
  name: "stdin is read to its end and written back under real Node",
  ignore: !USABLE,
  fn: async () => {
    const child = new Deno.Command("node", {
      args: [...RUN_TYPESCRIPT, STDIO_CANARY, "echo"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const sent = new Uint8Array(300_000).map((_, index) => index % 251);
    const writer = child.stdin.getWriter();
    await writer.write(sent.subarray(0, 100_000));
    await writer.write(sent.subarray(100_000));
    await writer.close();
    const { code, stdout, stderr } = await child.output();
    assertEquals({ code, stderr: decode(stderr) }, { code: 0, stderr: "" });
    assertEquals(stdout, sent);
  },
});

Deno.test({
  name:
    "a prompt shows its message and reads one line at a time under real Node",
  ignore: !USABLE,
  fn: async () => {
    const child = new Deno.Command("node", {
      args: [...RUN_TYPESCRIPT, STDIO_CANARY, "prompt"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    // Both lines at once: the first prompt must leave the second its line.
    await writer.write(new TextEncoder().encode("staging\r\nnaïve café\n"));
    await writer.close();
    const { code, stdout, stderr } = await child.output();
    assertEquals(
      { code, stdout: decode(stdout), stderr: decode(stderr).trim() },
      {
        code: 0,
        stdout: "first: second: third: ",
        // The third finds stdin at its end.
        stderr: JSON.stringify(["staging", "naïve café", null]),
      },
    );
  },
});

Deno.test({
  name:
    "the entry module under real Node is the script started, also through a symlink",
  ignore: !USABLE,
  fn: async () => {
    const dir = await Deno.makeTempDir();
    const link = `${dir}/started-through-a-link.mjs`;
    await Deno.symlink(RUNTIME_CANARY, link);
    try {
      const starts = [
        [RUNTIME_CANARY],
        [link],
        // Node then names the module by the link, not by where it leads.
        ["--preserve-symlinks-main", link],
      ];
      for (const start of starts) {
        const { code, stdout, stderr } = await new Deno.Command("node", {
          args: [...RUN_TYPESCRIPT, ...start, CORE_SOURCE],
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(
          { code, stdout: decode(stdout).trim(), stderr: decode(stderr) },
          { code: 0, stdout: "node runtime canary ok", stderr: "" },
        );
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
