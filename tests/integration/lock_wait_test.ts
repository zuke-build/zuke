// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: waiting for a held lock (`.waitUpTo(...)`), driven through the
 * real CLI with two runs overlapping in one process.
 *
 * There is deliberately **no wall-clock assumption** here. A test that sleeps
 * "long enough" for another run to reach a point is a test that rots on a
 * loaded machine, so each step waits on the event itself: the holder announces
 * itself through a shared log, and the waiter announces itself through the
 * reporter the harness injects. The only duration in the file is the
 * `waitUpTo` of the run that is *supposed* to run out of time, and it expires
 * because the lock is genuinely held, not because a timer won a race.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import type { Reporter } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/**
 * The percent-encoded `::`, kept as its own constant so the encoded prefix
 * never fuses with the word after it into a token no dictionary can know: the
 * spell gate reads the encoding and the word that follows it as one. The same
 * reason `report_test.ts` splits its literal.
 */
const ENC = "%3A%3A";

/**
 * The shared resource a lock usually guards — one dev environment, one
 * database, one port — plus the log of who was inside it when, which is what
 * the wait has to get right.
 *
 * Built per test rather than shared at module level: two tests sharing one
 * `release` means a failure in the first can leave the second's holder
 * unresolved, so one real failure reports as two and neither names itself.
 */
function sharedResource() {
  const order: string[] = [];
  let release: () => void = () => {};

  class HolderBuild extends Build {
    stack = target()
      .description("hold the shared resource until the test lets go")
      .lock((s) => s.lockKey("dev-env").withTtl("1h"))
      .executes(async () => {
        // `release` is assigned before the log entry the test polls for, so
        // observing "holder in" guarantees `release` points at this run.
        await new Promise<void>((resolve) => {
          release = resolve;
          order.push("holder in");
        });
        order.push("holder out");
      });
  }

  return {
    order,
    HolderBuild,
    release: () => release(),
    /** Resolves once the holder's body is inside, holding the lock. */
    async held(): Promise<void> {
      while (!order.includes("holder in")) {
        await new Promise((r) => setTimeout(r, 5));
      }
    },
  };
}

/** A reporter that records every line, plus a way to wait for one to appear. */
function recordingReporter(): {
  reporter: Reporter;
  lines: string[];
  await(fragment: string): Promise<void>;
} {
  const lines: string[] = [];
  const push = (line: string) => void lines.push(line);
  return {
    lines,
    reporter: { info: push, error: push },
    async await(fragment: string): Promise<void> {
      // The deadline is a failure mode, not a synchronisation point: the test
      // proceeds the instant the line appears, and the only thing this bounds
      // is how long a *broken* run takes to say so. An unbounded poll would
      // hang CI instead of reporting, which is the one way this could be worse
      // than the sleep it replaces.
      const deadline = Date.now() + 30_000;
      while (!lines.some((line) => line.includes(fragment))) {
        if (Date.now() > deadline) {
          throw new Error(
            `waited 30s for a run to report ${JSON.stringify(fragment)}; ` +
              `it reported: ${JSON.stringify(lines)}`,
          );
        }
        await new Promise((r) => setTimeout(r, 5));
      }
    },
  };
}

Deno.test("a second run waits for the lock and proceeds when the first finishes", async () => {
  await withStateDir(async () => {
    const { order, HolderBuild, release, held } = sharedResource();
    class WaiterBuild extends Build {
      stack = target()
        .description("queue for the shared resource rather than failing")
        .lock((s) =>
          s.lockKey("dev-env").withTtl("1h").waitUpTo("30s").pollEvery("10ms")
        )
        .executes(() => void order.push("waiter in"));
    }

    const holding = runCli(HolderBuild, ["stack"]);
    await held();

    const waiterOutput = recordingReporter();
    const waiting = runCli(WaiterBuild, ["stack"], {
      reporter: waiterOutput.reporter,
    });

    // Wait for the waiter to say it is queueing, rather than sleeping and
    // hoping. This is also what makes the release below meaningful: without
    // it the holder could let go before the waiter ever reached the lock, and
    // the test would pass having exercised no waiting at all.
    await waiterOutput.await(`Waiting for lock "dev-env"`);
    assertEquals(order.includes("waiter in"), false);

    release();
    const first = await holding;
    const second = await waiting;

    assertEquals(first.code, 0, first.err);
    assertEquals(second.code, 0, second.err);
    assertEquals(order, ["holder in", "holder out", "waiter in"]);
    // The waiter did not merely finish second — it queued, and said so. The
    // ordering above would hold even if the holder had let go before the
    // waiter ever reached the lock, so this is what proves the wait happened.
    // Its own reporter, not the console: two overlapping runs share the
    // console, and the holder's lines would land in the waiter's buffer.
    assertStringIncludes(
      waiterOutput.lines.join("\n"),
      `Waiting for lock "dev-env"`,
    );
  });
});

Deno.test("a waiter that runs out of time fails and says it waited", async () => {
  await withStateDir(async () => {
    const { order, HolderBuild, release, held } = sharedResource();
    class ImpatientBuild extends Build {
      stack = target()
        .description("give up quickly rather than queue")
        .lock((s) =>
          s.lockKey("dev-env").withTtl("1h").waitUpTo("50ms").pollEvery("10ms")
        )
        .executes(() => void order.push("impatient in"));
    }

    const holding = runCli(HolderBuild, ["stack"]);
    await held();

    // The lock is held for the whole of this run, so the wait expires for a
    // reason the test controls rather than a race it hopes to win. The 50ms in
    // the message is the *configured* wait, not a measured one.
    const impatient = await runCli(ImpatientBuild, ["stack"]);
    assertEquals(impatient.code, 1);
    assertStringIncludes(impatient.err, "still held after waiting 50ms");
    assertEquals(order.includes("impatient in"), false);

    release();
    assertEquals((await holding).code, 0);
  });
});

Deno.test("a lock holder's actor cannot forge a command in the waiting notice", async () => {
  // The waiting notice describes the run that holds the lock — its actor, id,
  // start time and url — and every one of those was written into the shared
  // state store by another run. On an Actions runner that lands on a stream
  // parsed for workflow commands, so it is neutralised like the forced-override
  // line beside it.
  const NL = String.fromCharCode(10);
  const forged = ["ci-bot", "::stop-commands::deadbeef"].join(NL);
  const prevActor = Deno.env.get("ZUKE_ACTOR");
  const prevActions = Deno.env.get("GITHUB_ACTIONS");
  Deno.env.set("ZUKE_ACTOR", forged);
  Deno.env.set("GITHUB_ACTIONS", "true");
  try {
    await withStateDir(async () => {
      const { HolderBuild, release, held } = sharedResource();
      class WaiterBuild extends Build {
        stack = target()
          .description("queue behind the hostile holder")
          .lock((s) =>
            s.lockKey("dev-env").withTtl("1h").waitUpTo("30s").pollEvery("10ms")
          )
          .executes(() => {});
      }

      const holderOutput = recordingReporter();
      const holding = runCli(HolderBuild, ["stack"], {
        reporter: holderOutput.reporter,
      });
      await held();

      const waiterOutput = recordingReporter();
      const waiting = runCli(WaiterBuild, ["stack"], {
        reporter: waiterOutput.reporter,
      });
      // The notice is what carries the holder's actor, so waiting for it is
      // also what makes the assertions below non-vacuous: without it they
      // would hold over an empty buffer.
      await waiterOutput.await(`Waiting for lock "dev-env"`);

      release();
      assertEquals((await holding).code, 0);
      assertEquals((await waiting).code, 0);

      const stream = waiterOutput.lines.join(NL).split(NL);
      // The actor survives as text — it is neutralised, not filtered — but no
      // line of it opens a command. Asserted on the line, not the substring:
      // `includes("::stop-commands::")` is true either way, since the encoded
      // form still ends in `-commands::`.
      assertStringIncludes(
        waiterOutput.lines.join(NL),
        ENC + "stop-commands::deadbeef",
      );
      assertEquals(
        stream.some((l) => l.startsWith("::stop-commands::")),
        false,
      );
    });
  } finally {
    if (prevActor === undefined) Deno.env.delete("ZUKE_ACTOR");
    else Deno.env.set("ZUKE_ACTOR", prevActor);
    if (prevActions === undefined) Deno.env.delete("GITHUB_ACTIONS");
    else Deno.env.set("GITHUB_ACTIONS", prevActions);
  }
});
