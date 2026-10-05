// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `.validateDuring(...)`: checks that run on an interval while a
 * target's body runs, and stop the body at the first failure.
 *
 * @module
 */

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target, type Validation } from "../src/target.ts";
import { parameter } from "../src/params.ts";
import { execute } from "../src/executor.ts";
import { runWhileValidating } from "../src/validate_during.ts";
import { messageOf } from "../src/internal.ts";
import { withTempStore } from "./_store.ts";

/** Resolve after `ms`, or as soon as `signal` fires. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** A check that fails on its `failOn`-th round, counting every round it runs. */
function counting(failOn = Infinity): Validation & { rounds: number } {
  const check = {
    rounds: 0,
    validate() {
      check.rounds++;
      if (check.rounds >= failOn) {
        throw new Error(`error ratio ${check.rounds}`);
      }
    },
  };
  return check;
}

Deno.test("a failing check stops the body and fails the target, without cancelling the run", async () => {
  const check = counting(1);
  let bodyAborted = false;
  class B extends Build {
    bake = target()
      .executes(async (ctx) => {
        await sleep(5_000, ctx.signal);
        bodyAborted = ctx.signal.aborted;
      })
      .validateDuring((s) => s.every(10).check(check));
  }
  const b = new B();
  discoverTargets(b);
  const started = Date.now();
  const result = await execute(b, b.bake, { silent: true, stateStore: false });
  assertEquals(result.ok, false);
  assertEquals(result.cancelled, undefined);
  assertEquals(messageOf(result.error), "error ratio 1");
  assertEquals(bodyAborted, true);
  assertEquals(Date.now() - started < 2_000, true);
});

Deno.test("passing checks keep running while the body runs, and stop when it ends", async () => {
  const check = counting();
  class B extends Build {
    bake = target()
      .executes(() => new Promise<void>((r) => setTimeout(r, 120)))
      .validateDuring((s) => s.every(20).check(check));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.bake, { silent: true, stateStore: false });
  assertEquals(result.ok, true);
  const after = check.rounds;
  assertEquals(after >= 2, true);
  await new Promise((r) => setTimeout(r, 80));
  assertEquals(check.rounds, after); // nothing ran once the body settled
});

Deno.test("a round never overlaps the next one", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const slow: Validation = {
    async validate() {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight--;
    },
  };
  class B extends Build {
    bake = target()
      .executes(() => new Promise<void>((r) => setTimeout(r, 150)))
      .validateDuring((s) => s.every(5).check(slow));
  }
  const b = new B();
  discoverTargets(b);
  await execute(b, b.bake, { silent: true, stateStore: false });
  assertEquals(maxInFlight, 1);
});

Deno.test("a body that ignores its signal still fails promptly on a failed check", async () => {
  let release: () => void = () => {};
  const stuck = new Promise<void>((r) => (release = r));
  class B extends Build {
    bake = target()
      .executes(() => stuck)
      .validateDuring((s) => s.every(10).check(counting(1)));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.bake, { silent: true, stateStore: false });
  release();
  assertEquals(result.ok, false);
  assertEquals(messageOf(result.error), "error ratio 1");
});

Deno.test("a failed check is not retried away by .retry", async () => {
  let attempts = 0;
  class B extends Build {
    bake = target()
      .retry(2)
      .executes(async (ctx) => {
        attempts++;
        await sleep(5_000, ctx.signal);
        if (ctx.signal.aborted) throw new Error("stopped");
      })
      .validateDuring((s) => s.every(10).check(counting(1)));
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.bake, { silent: true, stateStore: false });
  assertEquals(result.ok, false);
  assertEquals(attempts, 1);
});

Deno.test("a failed check reaches .onFailure like any other failure", async () => {
  await withTempStore(async (store) => {
    const undone: string[] = [];
    class B extends Build {
      stage = target().executes(() => {}).onCancel(() => this.rollback);
      bake = target()
        .dependsOn(this.stage)
        .onFailure(() => "cancel-run")
        .executes((ctx) => sleep(5_000, ctx.signal))
        .validateDuring((s) => s.every(10).check(counting(1)));
      rollback = target().executes(() => void undone.push("rollback"));
    }
    const b = new B();
    discoverTargets(b);
    const result = await execute(b, b.bake, {
      silent: true,
      stateStore: store,
    });
    assertEquals(result.cancelled, true);
    assertEquals(messageOf(result.error), "error ratio 1");
    assertEquals(undone, ["rollback"]);
  });
});

Deno.test("checks are not run under a dry run", async () => {
  const check = counting();
  class B extends Build {
    bake = target()
      .dryRunnable()
      .executes(() => new Promise<void>((r) => setTimeout(r, 60)))
      .validateDuring((s) => s.every(5).check(check));
  }
  const b = new B();
  discoverTargets(b);
  await execute(b, b.bake, { silent: true, dryRun: true });
  assertEquals(check.rounds, 0);
});

Deno.test("each check gets the target name and the run's redactor", async () => {
  const seen: string[] = [];
  class B extends Build {
    token = parameter("token").secret().default("s3cr3t-value");
    bake = target()
      .executes(() => new Promise<void>((r) => setTimeout(r, 60)))
      .validateDuring((s) =>
        s.every(10).check({
          validate: ({ target: name, redact }) => {
            seen.push(`${name}:${redact(`token=${this.token.value}`)}`);
          },
        })
      );
  }
  const b = new B();
  discoverTargets(b);
  await execute(b, b.bake, { silent: true, stateStore: false });
  assertEquals(seen.length > 0, true);
  assertEquals(seen[0].startsWith("bake:token="), true);
  assertEquals(seen[0].includes("s3cr3t-value"), false);
});

Deno.test("every validation of one run gets that run's id", async () => {
  const seen: Array<string | undefined> = [];
  const record: Validation = {
    validate: ({ runId }) => {
      seen.push(runId);
    },
  };
  class B extends Build {
    bake = target()
      .validateBefore(record)
      .validateAfter(record)
      .executes(() => new Promise<void>((r) => setTimeout(r, 40)))
      .validateDuring((s) => s.every(10).check(record));
  }
  const b = new B();
  discoverTargets(b);
  await execute(b, b.bake, { silent: true, stateStore: false });
  assertEquals(seen.length >= 3, true);
  assertEquals(typeof seen[0], "string");
  assertEquals(seen[0] !== "", true);
  assertEquals(seen.every((id) => id === seen[0]), true);
  // A second run is a different run.
  const first = seen[0];
  seen.length = 0;
  await execute(b, b.bake, { silent: true, stateStore: false });
  assertEquals(seen.length >= 3, true);
  assertEquals(seen.every((id) => id === seen[0] && id !== first), true);
});

Deno.test("a before or after validation sees the list it was attached in", async () => {
  const seen: Array<[string, readonly Validation[] | undefined]> = [];
  const named = (label: string): Validation => ({
    validate: ({ peers }) => {
      seen.push([label, peers]);
    },
  });
  const a = named("a");
  const b = named("b");
  const c = named("c");
  const during = named("during");
  class B extends Build {
    bake = target()
      .validateBefore(a, b)
      .validateAfter(c)
      .executes(() => new Promise<void>((r) => setTimeout(r, 30)))
      .validateDuring((s) => s.every(10).check(during));
  }
  const build = new B();
  discoverTargets(build);
  await execute(build, build.bake, { silent: true, stateStore: false });
  const peersOf = (label: string) => seen.find(([l]) => l === label)?.[1];
  assertEquals(peersOf("a"), [a, b]);
  assertEquals(peersOf("b"), [a, b]);
  assertEquals(peersOf("c"), [c]);
  // A during check runs in rounds beside the body, not beside its list: it
  // acts alone.
  assertEquals(seen.some(([l]) => l === "during"), true);
  assertEquals(peersOf("during"), undefined);
});

Deno.test("a malformed .validateDuring fails the target before the body runs", async () => {
  const cases: Array<[string, (b: ReturnType<typeof target>) => unknown]> = [
    ["set no interval", (t) => t.validateDuring((s) => s.check(counting()))],
    ["set no checks", (t) => t.validateDuring((s) => s.every("1m"))],
    [
      "needs a positive interval",
      (t) => t.validateDuring((s) => s.every(0).check(counting())),
    ],
    [
      "longer than the longest timer",
      (t) => t.validateDuring((s) => s.every("30d").check(counting())),
    ],
  ];
  for (const [message, declare] of cases) {
    let ran = false;
    class B extends Build {
      bake = target().executes(() => void (ran = true));
    }
    const b = new B();
    declare(b.bake);
    discoverTargets(b);
    const result = await execute(b, b.bake, {
      silent: true,
      stateStore: false,
    });
    assertEquals(result.ok, false);
    assertEquals(ran, false);
    assertStringIncludes(messageOf(result.error), message);
  }
});

Deno.test("a check that fails as the body finishes still fails the target", async () => {
  class B extends Build {
    bake = target()
      .executes(() => new Promise<void>((r) => setTimeout(r, 30)))
      .validateDuring((s) =>
        s.every(10).check({
          // Still deciding when the body ends, and then red.
          validate: () =>
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error("error rate 40%")), 60)
            ),
        })
      );
  }
  const b = new B();
  discoverTargets(b);
  const result = await execute(b, b.bake, { silent: true, stateStore: false });
  assertEquals(result.ok, false);
  assertEquals(messageOf(result.error), "error rate 40%");
});

Deno.test("a stuck check gets an aborted signal and does not hold a cancelled run", async () => {
  const run = new AbortController();
  let checkSignal: AbortSignal | undefined;
  const settled = runWhileValidating(
    () => new Promise<void>((r) => setTimeout(r, 20)),
    {
      intervalMs: 5,
      checks: [{
        validate: ({ signal }) => {
          checkSignal = signal;
          return new Promise<void>(() => {}); // never settles
        },
      }],
    },
    "bake",
    "run-1",
    new AbortController(),
    run.signal,
  );
  setTimeout(() => run.abort(), 60);
  await settled;
  assertEquals(checkSignal?.aborted, true);
});

Deno.test("a failed body does not wait for a check still running", async () => {
  let checkSignal: AbortSignal | undefined;
  const started = Date.now();
  const error = await runWhileValidating(
    () =>
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("boom")), 30)
      ),
    {
      intervalMs: 5,
      checks: [{
        validate: ({ signal }) => {
          checkSignal = signal;
          return new Promise<void>(() => {});
        },
      }],
    },
    "bake",
    "run-1",
    new AbortController(),
    new AbortController().signal,
  ).catch((e: unknown) => e);
  assertEquals(messageOf(error), "boom");
  assertEquals(checkSignal?.aborted, true);
  assertEquals(Date.now() - started < 1_000, true);
});

Deno.test("a round the body outlives stops before its next check and schedules none", async () => {
  const ran: string[] = [];
  await runWhileValidating(
    () => new Promise<void>((r) => setTimeout(r, 20)),
    {
      intervalMs: 5,
      checks: [
        {
          validate: () =>
            new Promise<void>((r) => {
              ran.push("slow");
              setTimeout(r, 60);
            }),
        },
        { validate: () => void ran.push("next") },
      ],
    },
    "bake",
    "run-1",
    new AbortController(),
    new AbortController().signal,
  );
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(ran, ["slow"]);
});

Deno.test("a body that settles after the run was cancelled does not wait on a round", async () => {
  const run = new AbortController();
  run.abort();
  await runWhileValidating(
    () => Promise.resolve(),
    { intervalMs: 1_000, checks: [counting()] },
    "bake",
    "run-1",
    new AbortController(),
    run.signal,
  );
});
