import { assertEquals, assertThrows } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { Group, group, target, TargetBuilder } from "../src/target.ts";

Deno.test("group expands to its members in dependsOn and tags them", () => {
  class B extends Build {
    a = target().executes(() => {});
    b = target().executes(() => {});
    batch = group(this.a, this.b);
    c = target().dependsOn(this.batch).executes(() => {});
    d = target().dependsOn(this.batch, this.c).executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  assertEquals(b.batch instanceof Group, true);
  assertEquals(b.c.dependsOn_.map((t) => t.name_), ["a", "b"]);
  assertEquals(b.d.dependsOn_.map((t) => t.name_), ["a", "b", "c"]);
  assertEquals(b.a.group_, b.batch);
  assertEquals(b.a.group_ === b.b.group_, true);
});

Deno.test("group tolerates an undefined (forward-referenced) member", () => {
  // @ts-expect-error exercising the runtime guard against an unbound reference
  const g = group(undefined);
  assertEquals(g.members_.length, 1);
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
