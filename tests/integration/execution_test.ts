/**
 * Integration: the executor's core flow, driven through the real CLI. Each test
 * defines a fixture build whose target bodies push their name onto a local
 * `log`, runs it via {@link runCli}, and asserts on the exit code plus the
 * recorded order — so the whole parse → graph → execute path is exercised, not
 * a unit seam.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

Deno.test("runs dependencies before dependents, in declared order", async () => {
  const log: string[] = [];
  class B extends Build {
    clean = target().executes(() => void log.push("clean"));
    compile = target().dependsOn(this.clean).executes(() =>
      void log.push("compile")
    );
    test = target().dependsOn(this.compile).executes(() =>
      void log.push("test")
    );
  }
  const { code } = await runCli(B, ["test"]);
  assertEquals(code, 0);
  assertEquals(log, ["clean", "compile", "test"]);
});

Deno.test("a diamond runs the shared dependency exactly once", async () => {
  const log: string[] = [];
  class B extends Build {
    base = target().executes(() => void log.push("base"));
    left = target().dependsOn(this.base).executes(() => void log.push("left"));
    right = target().dependsOn(this.base).executes(() =>
      void log.push("right")
    );
    top = target().dependsOn(this.left, this.right).executes(() =>
      void log.push("top")
    );
  }
  const { code } = await runCli(B, ["top"]);
  assertEquals(code, 0);
  assertEquals(log.filter((n) => n === "base").length, 1);
  assertEquals(log[log.length - 1], "top");
});

Deno.test("a body returning a value runs, and its promise is awaited before dependents", async () => {
  // TargetFn accepts any return, so `.executes(() => SomeTasks.run())` — which
  // resolves to a CommandOutput — needs no async wrapper; the returned promise
  // is still awaited before dependents start.
  const log: string[] = [];
  class B extends Build {
    produce = target().executes(() =>
      new Promise((resolve) => setTimeout(resolve, 10))
        .then(() => log.push("produce")) // resolves to a number, not void
    );
    consume = target().dependsOn(this.produce).executes(() =>
      log.push("consume")
    );
  }
  const { code } = await runCli(B, ["consume"]);
  assertEquals(code, 0);
  assertEquals(log, ["produce", "consume"]);
});

Deno.test("--parallel still honours dependency order", async () => {
  const log: string[] = [];
  class B extends Build {
    a = target().executes(() => void log.push("a"));
    b = target().dependsOn(this.a).executes(() => void log.push("b"));
  }
  const { code } = await runCli(B, ["b", "--parallel"]);
  assertEquals(code, 0);
  assertEquals(log.indexOf("a") < log.indexOf("b"), true);
});

Deno.test("--skip prunes a dependency from the run", async () => {
  const log: string[] = [];
  class B extends Build {
    slow = target().executes(() => void log.push("slow"));
    build = target().dependsOn(this.slow).executes(() =>
      void log.push("build")
    );
  }
  const { code } = await runCli(B, ["build", "--skip", "slow"]);
  assertEquals(code, 0);
  assertEquals(log, ["build"]);
});

Deno.test("a failing target exits 1 and skips its dependents", async () => {
  const log: string[] = [];
  class B extends Build {
    setup = target().executes(() => void log.push("setup"));
    boom = target().dependsOn(this.setup).executes(() => {
      log.push("boom");
      throw new Error("kaboom");
    });
    after = target().dependsOn(this.boom).executes(() =>
      void log.push("after")
    );
  }
  const { code } = await runCli(B, ["after"]);
  assertEquals(code, 1);
  assertEquals(log.includes("after"), false);
  assertEquals(log, ["setup", "boom"]);
});

Deno.test("the default target runs when no target is named", async () => {
  const log: string[] = [];
  class B extends Build {
    other = target().executes(() => void log.push("other"));
    default = target().dependsOn(this.other).executes(() =>
      void log.push("default")
    );
  }
  const { code } = await runCli(B, []);
  assertEquals(code, 0);
  assertEquals(log, ["other", "default"]);
});

Deno.test("--list names every declared target", async () => {
  class B extends Build {
    clean = target().description("Remove artifacts").executes(() => {});
    build = target().description("Compile").executes(() => {});
  }
  const { code, out } = await runCli(B, ["--list"]);
  assertEquals(code, 0);
  assertStringIncludes(out, "clean");
  assertStringIncludes(out, "build");
});
