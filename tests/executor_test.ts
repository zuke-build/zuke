import { assertEquals } from "./_assert.ts";
import { Build, type BuildResult, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { execute } from "../src/executor.ts";

const silent = { silent: true } as const;

Deno.test("executes dependencies before dependents, in order", async () => {
  const log: string[] = [];
  class B extends Build {
    clean = target().executes(() => void log.push("clean"));
    restore = target().executes(() => void log.push("restore"));
    compile = target()
      .dependsOn(this.clean, this.restore)
      .executes(() => void log.push("compile"));
    test = target().dependsOn(this.compile).executes(() =>
      void log.push("test")
    );
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.test, silent);
  assertEquals(result.ok, true);
  assertEquals(log[log.length - 1], "test");
  assertEquals(log.indexOf("compile") < log.indexOf("test"), true);
  assertEquals(log.indexOf("clean") < log.indexOf("compile"), true);
});

Deno.test("diamond shared target runs exactly once", async () => {
  const log: string[] = [];
  class B extends Build {
    base = target().executes(() => void log.push("base"));
    left = target().dependsOn(this.base).executes(() => void log.push("left"));
    right = target().dependsOn(this.base).executes(() =>
      void log.push("right")
    );
    top = target()
      .dependsOn(this.left, this.right)
      .executes(() => void log.push("top"));
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.top, silent);
  assertEquals(log.filter((n) => n === "base").length, 1);
});

Deno.test("a failing target aborts the run", async () => {
  const log: string[] = [];
  class B extends Build {
    first = target().executes(() => void log.push("first"));
    boom = target()
      .dependsOn(this.first)
      .executes(() => {
        throw new Error("kaboom");
      });
    last = target().dependsOn(this.boom).executes(() => void log.push("last"));
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.last, silent);
  assertEquals(result.ok, false);
  assertEquals((result.error as Error).message, "kaboom");
  assertEquals(log.includes("first"), true);
  assertEquals(log.includes("last"), false); // aborted before reaching last
  assertEquals(result.executed, ["first"]);
});

Deno.test("lifecycle hooks run around the plan", async () => {
  const events: string[] = [];
  class B extends Build {
    override onStart() {
      events.push("start");
    }
    override onFinish(r: BuildResult) {
      events.push(`finish:${r.ok}`);
    }
    work = target().executes(() => void events.push("work"));
  }
  const b = new B();
  discoverTargets(b);

  await execute(b, b.work, silent);
  assertEquals(events, ["start", "work", "finish:true"]);
});

Deno.test("skip removes a target from the plan", async () => {
  const log: string[] = [];
  class B extends Build {
    setup = target().executes(() => void log.push("setup"));
    main = target().dependsOn(this.setup).executes(() => void log.push("main"));
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.main, { silent: true, skip: ["setup"] });
  assertEquals(result.ok, true);
  assertEquals(log, ["main"]);
});

Deno.test("a target without a body fails fast", async () => {
  class B extends Build {
    incomplete = target().description("no body here");
  }
  const b = new B();
  discoverTargets(b);

  const result = await execute(b, b.incomplete, silent);
  assertEquals(result.ok, false);
  assertEquals(
    String((result.error as Error).message).includes("no body"),
    true,
  );
});
