import { assertEquals, assertThrows } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target, TargetBuilder } from "../src/target.ts";

Deno.test("target() builder is chainable and records configuration", () => {
  const dep = target();
  const t = target()
    .description("compile things")
    .dependsOn(dep)
    .executes(() => {});

  assertEquals(t instanceof TargetBuilder, true);
  assertEquals(t.description_, "compile things");
  assertEquals(t.dependsOn_, [dep]);
  assertEquals(typeof t.fn_, "function");
});

Deno.test("before/after record soft ordering hints", () => {
  const a = target();
  const b = target();
  const t = target().before(a).after(b);
  assertEquals(t.before_, [a]);
  assertEquals(t.after_, [b]);
});

Deno.test("discovery binds each target to its property name", () => {
  class B extends Build {
    clean = target().description("clean");
    compile = target().dependsOn(this.clean);
    notATarget = 42;
  }
  const b = new B();
  const targets = discoverTargets(b);

  assertEquals([...targets.keys()], ["clean", "compile"]);
  assertEquals(targets.get("clean")!.name_, "clean");
  assertEquals(targets.get("compile")!.name_, "compile");
});

Deno.test("discovery preserves declaration order", () => {
  class B extends Build {
    z = target();
    a = target();
    m = target();
  }
  assertEquals([...discoverTargets(new B()).keys()], ["z", "a", "m"]);
});

Deno.test("discovery rejects a target bound to two names", () => {
  const shared = target();
  class B extends Build {
    one = shared;
    two = shared;
  }
  assertThrows(() => discoverTargets(new B()), Error, "two names");
});
