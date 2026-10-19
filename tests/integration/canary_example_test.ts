// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the runnable canary example in `examples/canary-release`,
 * driven through the real CLI. Its platform is a weighted router on loopback,
 * so the whole rollout — stage, steps, inline bakes with an HTTP probe, then
 * promotion or rollback — runs here as a reader would run it, on a free port.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Release } from "../../examples/canary-release/zuke.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** A free port, so the test never collides with whatever holds 8080. */
const QUICK = ["--port", "0"];

Deno.test("canary example: a healthy candidate steps through and is promoted", async () => {
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Release, ["ship", ...QUICK]);
    assertEquals(code, 0, err);
    assertStringIncludes(out, "v2 serves all traffic.");
    assertStringIncludes(out, "Promoted: local router");
  });
});

Deno.test("canary example: a broken candidate fails the probe and is rolled back", async () => {
  await withStateDir(async () => {
    const { code, out, err } = await runCli(Release, [
      "ship",
      "--broken",
      ...QUICK,
    ]);
    assertEquals(code, 1);
    assertStringIncludes(out + err, "HTTP 500");
    assertStringIncludes(
      out + err,
      "compensating rollout.stage → rollout.abort",
    );
    assertEquals(out.includes("v2 serves all traffic."), false);
  });
});

Deno.test("canary example: a port already in use is named, with the way out", async () => {
  const taken = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  try {
    await withStateDir(async () => {
      const { code, out, err } = await runCli(Release, [
        "ship",
        "--port",
        String(taken.addr.port),
      ]);
      assertEquals(code, 1);
      assertStringIncludes(
        out + err,
        `Port ${taken.addr.port} is already in use — pass --port <n>`,
      );
    });
  } finally {
    taken.close();
  }
});
