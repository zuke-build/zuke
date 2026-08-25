// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: `exitAfterResult` must end a Node process that would otherwise
 * never exit. Whether a child that holds the event loop open ever closes its
 * stdout — and so whether the evaluation settles — is a property of two real
 * processes, which is exactly what an in-process test cannot show. The
 * {@link file://./fixtures/node_evaluate_build.ts} fixture evaluates
 * {@link file://./fixtures/hanging_module.mjs}, whose export returns a value
 * and then keeps a timer alive forever.
 *
 * Unlike the rest of this suite these tests need a real `node` on `PATH`, so
 * they are skipped where there is none. CI's OS matrix has one; the fast unit
 * gate never reaches this file (it is `*_e2e.ts`), so a developer without Node
 * still gets a green `deno task ci`.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { runFixture, spawnFixture } from "./_harness.ts";

const FIXTURE = new URL("./fixtures/node_evaluate_build.ts", import.meta.url);

/** A generous bound: the evaluation is milliseconds' work once the child exits. */
const MAX_MS = 60_000;

/** How long the un-opted-in run is given to prove it is stuck. */
const HANG_MS = 5_000;

/** Whether a usable `node` is on `PATH` — these tests are skipped without one. */
async function nodeAvailable(): Promise<boolean> {
  try {
    const { success } = await new Deno.Command("node", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return success;
  } catch {
    return false;
  }
}

const HAS_NODE = await nodeAvailable();

/**
 * On CI the skip is not allowed: every runner in the matrix ships Node, so a
 * missing one means the environment changed, and silently skipping would retire
 * this coverage without anyone noticing. Locally the skip stands, which is what
 * keeps a Node-less checkout green.
 */
const MUST_HAVE_NODE = Deno.env.get("CI") === "true";

Deno.test({
  name: "CI runs these tests rather than skipping them",
  ignore: !MUST_HAVE_NODE,
  fn: () => {
    assertEquals(
      HAS_NODE,
      true,
      "no usable `node` on PATH: the Node evaluation e2e tests would have " +
        "been skipped on a runner that is supposed to provide one.",
    );
  },
});

Deno.test({
  name: "exitAfterResult finishes a build whose module never exits",
  ignore: !HAS_NODE,
  fn: async () => {
    const started = performance.now();
    const { code, out, err } = await runFixture(FIXTURE, ["hanging"], {});
    const elapsed = performance.now() - started;
    const output = out + err;

    assertEquals(code, 0, `expected a passing build:\n${output}`);
    assertEquals(
      out.includes(`VALUE={"document":"3.1.0"}`),
      true,
      `the evaluated value never reached the target:\n${output}`,
    );
    assertEquals(elapsed < MAX_MS, true, `took ${Math.round(elapsed)}ms`);
  },
});

Deno.test({
  name: "without the option the same module hangs, which is what it fixes",
  ignore: !HAS_NODE,
  fn: async () => {
    // Guards the test above from a fixture that quietly stopped hanging: if the
    // module ever exits on its own, this run would print its value and the
    // passing case would no longer prove anything.
    const child = spawnFixture(FIXTURE, ["waiting"], {});
    const timer = setTimeout(() => child.kill("SIGKILL"), HANG_MS);
    const { stdout } = await child.output();
    clearTimeout(timer);

    assertEquals(
      new TextDecoder().decode(stdout).includes("VALUE="),
      false,
      "the module exited on its own, so the fixture no longer hangs",
    );
  },
});
