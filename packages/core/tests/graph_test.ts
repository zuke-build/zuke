import { assertEquals, assertThrows } from "./_assert.ts";
import { Build, discoverTargets, resolveOrderingEdges } from "../src/build.ts";
import { target, type TargetBuilder } from "../src/target.ts";
import {
  executionSet,
  findCycle,
  GraphError,
  type OrderingEdge,
  plan,
  planGraph,
  validateGraph,
  validateReferences,
} from "../src/graph.ts";

/** Build a discovered-target map from a Build subclass instance. */
function discover(b: Build) {
  return discoverTargets(b);
}

Deno.test("planGraph returns the order and each target's predecessors", () => {
  class B extends Build {
    base = target().executes(() => {});
    left = target().dependsOn(this.base).executes(() => {});
    right = target().dependsOn(this.base).executes(() => {});
    top = target().dependsOn(this.left, this.right).executes(() => {});
  }
  const b = new B();
  discover(b);
  const { order, predecessors } = planGraph(b.top);

  const names = order.map((t) => t.name_);
  assertEquals(names[0], "base");
  assertEquals(names[names.length - 1], "top");
  assertEquals([...names].sort(), ["base", "left", "right", "top"]);
  assertEquals(predecessors.get(b.base)?.map((t) => t.name_), []);
  assertEquals(predecessors.get(b.left)?.map((t) => t.name_), ["base"]);
  assertEquals(
    predecessors.get(b.top)?.map((t) => t.name_),
    ["left", "right"],
  );
});

Deno.test("planGraph detects cycles", () => {
  class B extends Build {
    a = target().executes(() => {});
    b = target().executes(() => {});
    constructor() {
      super();
      this.a.dependsOn(this.b);
      this.b.dependsOn(this.a);
    }
  }
  const b = new B();
  discover(b);
  assertThrows(() => planGraph(b.a), GraphError, "cycle");
});

Deno.test("triggers pull targets into the plan and run them after", () => {
  class B extends Build {
    cleanup = target().executes(() => {});
    main = target().triggers(this.cleanup).executes(() => {});
  }
  const b = new B();
  discover(b);
  const order = plan(b.main).map((t) => t.name_);
  assertEquals(order.includes("cleanup"), true); // pulled into the plan
  assertEquals(order.indexOf("main") < order.indexOf("cleanup"), true);
});

Deno.test("validateReferences rejects an undefined trigger", () => {
  const main = target();
  main.name_ = "main";
  // @ts-expect-error simulate a forward-referenced (unbound) trigger
  main.triggers(undefined);
  assertThrows(
    () => validateReferences(new Map([["main", main]])),
    GraphError,
    "undefined target",
  );
});

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
    "undefined target",
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

Deno.test("extra edges impose soft ordering between independent targets", () => {
  class B extends Build {
    a = target().executes(() => {});
    b = target().executes(() => {});
    root = target().dependsOn(this.a, this.b).executes(() => {});
  }
  const inst = new B();
  discover(inst); // assign name_
  const names = (extra: readonly [typeof inst.a, typeof inst.a][]) =>
    plan(inst.root, extra).map((t) => t.name_);
  // The default (topological) order of the two independent siblings.
  const base = names([]);
  assertEquals(base, ["b", "a", "root"]);
  // An extra edge a→b forces a before b, flipping the sibling order.
  assertEquals(names([[inst.a, inst.b]]), ["a", "b", "root"]);
});

Deno.test("an extra edge with an endpoint outside the run is ignored", () => {
  class B extends Build {
    a = target().executes(() => {});
    b = target().executes(() => {});
    orphan = target().executes(() => {}); // not reachable from root
    root = target().dependsOn(this.a, this.b).executes(() => {});
  }
  const inst = new B();
  discover(inst);
  // `orphan` is not in root's execution set, so the edge is silently dropped
  // and the order is unchanged from the no-edge plan.
  assertEquals(
    plan(inst.root, [[inst.orphan, inst.a]]).map((t) => t.name_),
    plan(inst.root, []).map((t) => t.name_),
  );
});

Deno.test("an extra edge that forms a cycle is reported", () => {
  class B extends Build {
    a = target().executes(() => {});
    root = target().dependsOn(this.a).executes(() => {});
  }
  const inst = new B();
  discover(inst);
  // root already runs after a; forcing root before a closes a cycle.
  assertThrows(
    () => plan(inst.root, [[inst.root, inst.a]]),
    GraphError,
    "cycle detected",
  );
});

Deno.test("Build.extraEdges defaults to no edges", () => {
  class B extends Build {}
  assertEquals(new B().extraEdges(new Map()), []);
});

Deno.test("Build.orderWith defaults to no edges", async () => {
  class B extends Build {}
  assertEquals(await new B().orderWith(new Map()), []);
});

Deno.test("resolveOrderingEdges merges extraEdges with an async orderWith", async () => {
  class B extends Build {
    a = target().executes(() => {});
    b = target().executes(() => {});
    c = target().executes(() => {});
    all = target().dependsOn(this.a, this.b, this.c).executes(() => {});
    override extraEdges(t: Map<string, TargetBuilder>): OrderingEdge[] {
      const a = t.get("a"), b = t.get("b");
      return a && b ? [[a, b]] : [];
    }
    override async orderWith(
      t: Map<string, TargetBuilder>,
    ): Promise<OrderingEdge[]> {
      await Promise.resolve(); // a genuinely async provider (e.g. a fetch)
      const b = t.get("b"), c = t.get("c");
      return b && c ? [[b, c]] : [];
    }
  }
  const build = new B();
  const targets = discoverTargets(build);
  const edges = await resolveOrderingEdges(build, targets);
  // One edge from extraEdges (a→b) and one from orderWith (b→c).
  assertEquals(edges.length, 2);
  const order = planGraph(build.all, edges).order.map((t) => t.name_);
  // The merged edges chain a → b → c within the run's execution set.
  assertEquals(order.indexOf("a") < order.indexOf("b"), true);
  assertEquals(order.indexOf("b") < order.indexOf("c"), true);
});
