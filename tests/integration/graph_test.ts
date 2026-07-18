/**
 * Integration: the dependency-graph flow, driven through the real CLI. Each
 * test defines a fixture build locally — closing over a `log` array for the
 * ordering cases — runs it via {@link runCli}, and asserts on the exit code
 * plus `err`/`log`, so the whole parse → validate → graph path is exercised,
 * not a unit seam.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

Deno.test("before/after soft ordering hints are honoured", async () => {
  const log: string[] = [];
  class B extends Build {
    setup = target().executes(() => void log.push("setup"));
    work = target().dependsOn(this.setup).executes(() => void log.push("work"));
    lint = target().after(this.setup).before(this.work).executes(() =>
      void log.push("lint")
    );
    all = target().dependsOn(this.work, this.lint).executes(() =>
      void log.push("all")
    );
  }
  const { code } = await runCli(B, ["all"]);
  assertEquals(code, 0);
  const idx = (n: string) => log.indexOf(n);
  assertEquals(idx("setup") < idx("lint"), true);
  assertEquals(idx("lint") < idx("work"), true);
  assertEquals(log[log.length - 1], "all");
});

Deno.test("a dependency cycle exits 1 and names the cycle path", async () => {
  class B extends Build {
    a = target().executes(() => {});
    b = target().executes(() => {});
    constructor() {
      super();
      this.a.dependsOn(this.b);
      this.b.dependsOn(this.a);
    }
  }
  const { code, err } = await runCli(B, ["a"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "Dependency cycle detected: a → b → a");
});

Deno.test("a forward reference exits 1 with a validateReferences error", async () => {
  class B extends Build {
    // TypeScript catches this forward reference at compile time; the
    // suppression simulates a consumer that bypassed type-checking,
    // exercising the runtime guard. Class fields initialise top-to-bottom, so
    // `this.later` is undefined here.
    // @ts-expect-error -- deliberately forward-references a later field
    early = target().dependsOn(this.later).executes(() => {});
    later = target().executes(() => {});
  }
  const { code, err } = await runCli(B, ["later"]);
  assertEquals(code, 1);
  assertStringIncludes(err, 'Target "early" depends on an undefined target.');
});

Deno.test("an unknown target name exits 1 with a helpful message", async () => {
  class B extends Build {
    build = target().executes(() => {});
  }
  const { code, err } = await runCli(B, ["nope"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "Unknown target: nope");
});
