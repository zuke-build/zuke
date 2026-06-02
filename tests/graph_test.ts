import { assertEquals, assertThrows } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import {
  executionSet,
  findCycle,
  GraphError,
  plan,
  validateGraph,
  validateReferences,
} from "../src/graph.ts";

/** Build a discovered-target map from a Build subclass instance. */
function discover(b: Build) {
  return discoverTargets(b);
}

Deno.test("topological order respects dependencies", () => {
  class B extends Build {
    clean = target().executes(() => {});
    restore = target().executes(() => {});
    compile = target().dependsOn(this.clean, this.restore).executes(() => {});
    test = target().dependsOn(this.compile).executes(() => {});
  }
  const b = new B();
  discover(b);
  const order = plan(b.test).map((t) => t.name_);

  // test last; compile before test; clean & restore before compile.
  assertEquals(order[order.length - 1], "test");
  const idx = (n: string) => order.indexOf(n);
  assertEquals(idx("compile") < idx("test"), true);
  assertEquals(idx("clean") < idx("compile"), true);
  assertEquals(idx("restore") < idx("compile"), true);
});

Deno.test("diamond dependencies appear exactly once", () => {
  class B extends Build {
    base = target().executes(() => {});
    left = target().dependsOn(this.base).executes(() => {});
    right = target().dependsOn(this.base).executes(() => {});
    top = target().dependsOn(this.left, this.right).executes(() => {});
  }
  const b = new B();
  discover(b);
  const order = plan(b.top).map((t) => t.name_);

  assertEquals(order.filter((n) => n === "base").length, 1);
  assertEquals(order.length, 4);
  assertEquals(order[order.length - 1], "top");
});

Deno.test("execution set is the transitive closure of the root", () => {
  class B extends Build {
    a = target().executes(() => {});
    b = target().dependsOn(this.a).executes(() => {});
    c = target().dependsOn(this.b).executes(() => {});
    unrelated = target().executes(() => {});
  }
  const inst = new B();
  discover(inst);
  const set = [...executionSet(inst.c)].map((t) => t.name_).sort();
  assertEquals(set, ["a", "b", "c"]);
});

Deno.test("findCycle reports the offending path", () => {
  class B extends Build {
    a = target();
    b = target();
    c = target();
  }
  const inst = new B();
  // a → b → c → a
  inst.a.dependsOn(inst.b);
  inst.b.dependsOn(inst.c);
  inst.c.dependsOn(inst.a);
  discover(inst);

  const cycle = findCycle(discover(inst));
  if (cycle === null) throw new Error("expected a cycle to be found");
  // The path starts and ends at the same node.
  assertEquals(cycle[0], cycle[cycle.length - 1]);
});

Deno.test("validateGraph throws GraphError with the cycle path", () => {
  class B extends Build {
    a = target();
    b = target();
  }
  const inst = new B();
  inst.a.dependsOn(inst.b);
  inst.b.dependsOn(inst.a);

  assertThrows(
    () => validateGraph(discover(inst)),
    GraphError,
    "cycle detected",
  );
});

Deno.test("validateReferences rejects a dependency on an undiscovered target", () => {
  const orphan = target(); // never assigned to a property
  class B extends Build {
    a = target().dependsOn(orphan);
  }
  assertThrows(
    () => validateReferences(discover(new B())),
    GraphError,
    "not discovered",
  );
});

Deno.test("validateReferences rejects an undefined (forward-referenced) dep", () => {
  class B extends Build {
    // TypeScript catches this forward reference (TS2729); the suppression
    // simulates a consumer that bypassed type-checking, exercising the runtime
    // guard. Class fields initialise top-to-bottom, so `this.later` is undefined.
    // @ts-expect-error -- deliberately forward-references a later field

    early = target().dependsOn(this.later).executes(() => {});
    later = target().executes(() => {});
  }
  assertThrows(
    () => validateReferences(discover(new B())),
    GraphError,
    "undefined dependency",
  );
});

Deno.test("soft before/after hints order nodes within the plan", () => {
  class B extends Build {
    setup = target().executes(() => {});
    work = target().dependsOn(this.setup).executes(() => {});
    // `lint` has no hard dep but should run after setup when both are planned.
    lint = target().after(this.setup).before(this.work).executes(() => {});
  }
  const b = new B();
  discover(b);
  // Pull lint into the plan by depending on it from a root.
  const root = target().dependsOn(b.work, b.lint).executes(() => {});
  root.name_ = "root";

  const order = plan(root).map((t) => t.name_);
  const idx = (n: string) => order.indexOf(n);
  assertEquals(idx("setup") < idx("lint"), true);
  assertEquals(idx("lint") < idx("work"), true);
});

Deno.test("plan detects a cycle introduced by soft edges", () => {
  class B extends Build {
    a = target().executes(() => {});
    b = target().executes(() => {});
  }
  const inst = new B();
  // a before b, and b before a → soft cycle.
  inst.a.before(inst.b);
  inst.b.before(inst.a);
  discover(inst);
  const root = target().dependsOn(inst.a, inst.b).executes(() => {});
  root.name_ = "root";

  assertThrows(() => plan(root), GraphError, "cycle detected");
});
