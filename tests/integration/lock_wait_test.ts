// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

// The shared resource stands in for the ones a lock is usually guarding: one
// dev environment, one database, one port. `order` records who was inside it
// when, which is what the wait has to get right.
const order: string[] = [];

/** Released by the test once the first run has taken the lock. */
let release: () => void = () => {};

class HolderBuild extends Build {
  stack = target()
    .description("hold the shared resource until the test lets go")
    .lock((s) => s.lockKey("dev-env").withTtl("1h"))
    .executes(async () => {
      order.push("holder in");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("holder out");
    });
}

class WaiterBuild extends Build {
  stack = target()
    .description("queue for the shared resource rather than failing")
    .lock((s) =>
      s.lockKey("dev-env").withTtl("1h").waitUpTo("30s").pollEvery("10ms")
    )
    .executes(() => {
      order.push("waiter in");
    });
}

class ImpatientBuild extends Build {
  stack = target()
    .description("give up quickly rather than queue")
    .lock((s) =>
      s.lockKey("dev-env").withTtl("1h").waitUpTo("50ms").pollEvery("10ms")
    )
    .executes(() => {
      order.push("impatient in");
    });
}

Deno.test("a second run waits for the lock and proceeds when the first finishes", async () => {
  await withStateDir(async () => {
    order.length = 0;
    const holding = runCli(HolderBuild, ["stack"]);
    // Let the holder's target reach its body and take the lock.
    while (!order.includes("holder in")) {
      await new Promise((r) => setTimeout(r, 5));
    }

    const waiting = runCli(WaiterBuild, ["stack"]);
    // The waiter must still be queueing: it cannot have run yet.
    await new Promise((r) => setTimeout(r, 50));
    assertEquals(order.includes("waiter in"), false);

    release();
    const first = await holding;
    const second = await waiting;

    assertEquals(first.code, 0, first.err);
    assertEquals(second.code, 0, second.err);
    assertEquals(order, ["holder in", "holder out", "waiter in"]);
    // While it waited, the run said whose lock it was waiting on.
    assertStringIncludes(second.out, `Waiting for lock "dev-env"`);
  });
});

Deno.test("a waiter that runs out of time fails and says it waited", async () => {
  await withStateDir(async () => {
    order.length = 0;
    const holding = runCli(HolderBuild, ["stack"]);
    while (!order.includes("holder in")) {
      await new Promise((r) => setTimeout(r, 5));
    }

    const impatient = await runCli(ImpatientBuild, ["stack"]);
    assertEquals(impatient.code, 1);
    assertStringIncludes(impatient.err, "still held after waiting 50ms");
    assertEquals(order.includes("impatient in"), false);

    release();
    assertEquals((await holding).code, 0);
  });
});
