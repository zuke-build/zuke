/**
 * Integration: conditional execution, retries, timeouts, validation, and
 * recovery, driven through the real CLI. Each test defines a fixture build
 * whose target bodies push their name onto a local `log`, runs it via
 * {@link runCli}, and asserts on the exit code plus the recorded order — so
 * the whole parse → graph → execute path is exercised, not a unit seam.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

Deno.test("onlyWhen(() => false) skips the target; onlyWhen(() => true) runs it", async () => {
  const skippedLog: string[] = [];
  class Skipped extends Build {
    gated = target().onlyWhen(() => false).executes(() =>
      void skippedLog.push("gated")
    );
  }
  const skippedResult = await runCli(Skipped, ["gated"]);
  assertEquals(skippedResult.code, 0);
  assertEquals(skippedLog, []); // body never ran

  const ranLog: string[] = [];
  class Ran extends Build {
    gated = target().onlyWhen(() => true).executes(() =>
      void ranLog.push("gated")
    );
  }
  const ranResult = await runCli(Ran, ["gated"]);
  assertEquals(ranResult.code, 0);
  assertEquals(ranLog, ["gated"]);
});

Deno.test("whenSkipped('run-dependencies') (also the default) still runs a skipped target's dependencies", async () => {
  // Explicit "run-dependencies": the dependency still runs; the gated target
  // itself is skipped (its condition is false).
  const explicitLog: string[] = [];
  class RunDeps extends Build {
    onlyForDocs = target().executes(() => void explicitLog.push("onlyForDocs"));
    docs = target()
      .dependsOn(this.onlyForDocs)
      .onlyWhen(() => false)
      .whenSkipped("run-dependencies")
      .executes(() => void explicitLog.push("docs"));
  }
  const explicitResult = await runCli(RunDeps, ["docs"]);
  assertEquals(explicitResult.code, 0);
  assertEquals(explicitLog, ["onlyForDocs"]);

  // No whenSkipped() call: the default behaves the same way.
  const defaultLog: string[] = [];
  class DefaultBehaviour extends Build {
    onlyForDocs = target().executes(() => void defaultLog.push("onlyForDocs"));
    docs = target()
      .dependsOn(this.onlyForDocs)
      .onlyWhen(() => false)
      .executes(() => void defaultLog.push("docs"));
  }
  const defaultResult = await runCli(DefaultBehaviour, ["docs"]);
  assertEquals(defaultResult.code, 0);
  assertEquals(defaultLog, ["onlyForDocs"]);
});

Deno.test("whenSkipped('skip-dependencies') skips the target's exclusive dependencies too", async () => {
  const log: string[] = [];
  class SkipDeps extends Build {
    onlyForDocs = target().executes(() => void log.push("onlyForDocs"));
    docs = target()
      .dependsOn(this.onlyForDocs)
      .onlyWhen(() => false)
      .whenSkipped("skip-dependencies")
      .executes(() => void log.push("docs"));
  }
  const result = await runCli(SkipDeps, ["docs"]);
  assertEquals(result.code, 0);
  assertEquals(log, []); // both the target and its exclusive dependency skipped
});

Deno.test("always() runs a target for cleanup even after a dependency failed", async () => {
  const log: string[] = [];
  class B extends Build {
    boom = target().executes(() => {
      log.push("boom");
      throw new Error("boom");
    });
    cleanup = target().always().executes(() => void log.push("cleanup"));
    all = target().dependsOn(this.boom, this.cleanup).executes(() =>
      void log.push("all")
    );
  }
  const { code } = await runCli(B, ["all"]);
  assertEquals(code, 1);
  assertEquals(log.includes("boom"), true);
  assertEquals(log.includes("cleanup"), true); // ran despite the failed dependency
  assertEquals(log.includes("all"), false); // blocked by the failed dependency
});

Deno.test("triggers() and dependentFor() pull extra targets into the run", async () => {
  const log: string[] = [];
  class B extends Build {
    notify = target().executes(() => void log.push("notify"));
    build = target().triggers(this.notify).executes(() =>
      void log.push("build")
    );
    // audit is declared after build (the target it must precede), and joins
    // build's dependencies via dependentFor rather than build depending on it
    // directly.
    audit = target().dependentFor(this.build).executes(() =>
      void log.push("audit")
    );
  }
  const { code } = await runCli(B, ["build"]);
  assertEquals(code, 0);
  // audit is pulled in as a dependency of build (runs first); notify is
  // triggered to run after build.
  assertEquals(log, ["audit", "build", "notify"]);
});

Deno.test("retry(3, 0) re-runs a flaky body until it succeeds", async () => {
  let attempts = 0;
  class B extends Build {
    flaky = target()
      .retry(3, 0)
      .executes(() => {
        attempts++;
        if (attempts < 3) throw new Error("flaky");
      });
  }
  const { code } = await runCli(B, ["flaky"]);
  assertEquals(code, 0);
  assertEquals(attempts, 3); // 2 failures then a success
});

Deno.test("timeout(10) fails a body that sleeps longer than the deadline", async () => {
  // The executor abandons a timed-out body but cannot cancel it (documented in
  // runWithTimeout), so the body's own timer keeps running. Capture it and
  // clear it after asserting, so this test never leaves a live timer behind for
  // the op sanitizer to trip on.
  let bodyTimer: ReturnType<typeof setTimeout> | undefined;
  class B extends Build {
    slow = target()
      .timeout(10)
      .executes(() =>
        new Promise<void>((resolve) => {
          bodyTimer = setTimeout(resolve, 80);
        })
      );
  }
  const { code, out, err } = await runCli(B, ["slow"]);
  assertEquals(code, 1);
  assertStringIncludes(out + err, "timed out");
  if (bodyTimer !== undefined) clearTimeout(bodyTimer);
});

Deno.test("validateBefore failing skips the body; a passing validateAfter runs after it", async () => {
  const log: string[] = [];
  class Blocked extends Build {
    work = target()
      .validateBefore({
        validate: () => {
          throw new Error("gate failed");
        },
      })
      .executes(() => void log.push("body"));
  }
  const blocked = await runCli(Blocked, ["work"]);
  assertEquals(blocked.code, 1);
  assertEquals(log, []); // the body never ran
  assertStringIncludes(blocked.out + blocked.err, "gate failed");

  class Passing extends Build {
    work = target()
      .validateAfter({ validate: () => void log.push("after") })
      .executes(() => void log.push("body"));
  }
  const passing = await runCli(Passing, ["work"]);
  assertEquals(passing.code, 0);
  assertEquals(log, ["body", "after"]);
});

Deno.test("recoverWith runs a remediation on failure and can recover the target", async () => {
  const log: string[] = [];
  let healed = false;
  class B extends Build {
    work = target()
      .recoverWith({
        remediate: (ctx) => {
          log.push(`remediate:${ctx.target}`);
          healed = true;
          return { retry: true };
        },
      })
      .executes(() => {
        log.push("body");
        if (!healed) throw new Error("boom");
      });
  }
  const { code } = await runCli(B, ["work"]);
  assertEquals(code, 0);
  assertEquals(log, ["body", "remediate:work", "body"]);
});
