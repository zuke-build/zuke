import { assertEquals, assertThrows } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { Group, group, target, TargetBuilder } from "../src/target.ts";

Deno.test("partOf joins a group; dependsOn(group) expands to its members", () => {
  class B extends Build {
    checks = group();
    a = target().partOf(this.checks).executes(() => {});
    b = target().partOf(this.checks).executes(() => {});
    c = target().dependsOn(this.checks).executes(() => {});
    d = target().dependsOn(this.checks, this.c).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  assertEquals(b.checks instanceof Group, true);
  assertEquals(b.checks.members_.map((t) => t.name_), ["a", "b"]);
  assertEquals(b.a.group_, b.checks);
  assertEquals(b.a.group_ === b.b.group_, true);
  assertEquals(b.c.dependsOn_.map((t) => t.name_), ["a", "b"]);
  assertEquals(b.d.dependsOn_.map((t) => t.name_), ["a", "b", "c"]);
});

Deno.test("partOf ignores an undefined (forward-referenced) group", () => {
  const t = target();
  // @ts-expect-error exercising the runtime guard against an unbound reference
  t.partOf(undefined);
  assertEquals(t.group_, undefined);
});

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
