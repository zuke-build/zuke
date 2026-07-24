import { assertEquals, assertThrows } from "./_assert.ts";
import { Build, discoverGroups, discoverTargets } from "../src/build.ts";
import { Group, group, target, TargetBuilder } from "../src/target.ts";
import { parameter } from "../src/params.ts";

Deno.test("discovery recurses into component bundles with dotted names", () => {
  // A reusable component: a function returning a bundle of related targets.
  const releasable = () => {
    const pack = target().executes(() => {});
    const publish = target().dependsOn(pack).executes(() => {});
    return { pack, publish };
  };
  class B extends Build {
    release = releasable();
    deploy = target().dependsOn(this.release.publish).executes(() => {});
  }
  const b = new B();
  const targets = discoverTargets(b);
  assertEquals([...targets.keys()], [
    "release.pack",
    "release.publish",
    "deploy",
  ]);
  assertEquals(b.release.pack.name_, "release.pack");
  assertEquals(b.deploy.dependsOn_.map((t) => t.name_), ["release.publish"]);
});

Deno.test("discovery handles nested components and cyclic plain objects", () => {
  const inner = () => ({ build: target().executes(() => {}) });
  class B extends Build {
    group = { ci: inner() }; // nested component bundle
    plain = { note: "not a target" };
  }
  const b = new B();
  // A self-referential plain object must not loop forever.
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  Object.assign(b, { cyclic });
  const targets = discoverTargets(b);
  assertEquals([...targets.keys()], ["group.ci.build"]);
});

Deno.test("discoverGroups binds each group to its property name", () => {
  class B extends Build {
    checks = group();
    a = target().partOf(this.checks).executes(() => {});
  }
  const b = new B();
  const groups = discoverGroups(b);
  assertEquals([...groups.keys()], ["checks"]);
  assertEquals(b.checks.name_, "checks");
});

Deno.test("triggers, dependentFor, requires, proceedAfterFailure, unlisted record config", () => {
  class B extends Build {
    before = target().executes(() => {});
    after = target().executes(() => {});
    token = parameter("token");
    main = target()
      .triggers(this.after)
      .dependentFor(this.before)
      .requires(this.token)
      .proceedAfterFailure()
      .unlisted()
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  assertEquals(b.main.triggers_.map((t) => t.name_), ["after"]);
  assertEquals(b.before.dependsOn_.map((t) => t.name_), ["main"]); // dependentFor
  assertEquals(b.main.requires_.length, 1);
  assertEquals(b.main.proceedAfterFailure_, true);
  assertEquals(b.main.unlisted_, true);
});

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

Deno.test("inputs, outputs, and onlyWhen record their configuration", () => {
  let allow = false;
  const t = target()
    .inputs("src", "deno.json")
    .outputs("dist")
    .onlyWhen(() => allow)
    .executes(() => {});
  assertEquals(t.inputs_, ["src", "deno.json"]);
  assertEquals(t.outputs_, ["dist"]);
  assertEquals(t.onlyWhen_.length, 1);
  assertEquals(t.onlyWhen_[0](), false);
  allow = true;
  assertEquals(t.onlyWhen_[0](), true);
});

Deno.test("cacheKey, produces, consumes, always, whenSkipped record config", () => {
  class B extends Build {
    dep = target().executes(() => {});
    main = target()
      .inputs("src")
      .cacheKey(() => "v1")
      .produces("dist")
      .consumes(this.dep)
      .always()
      .whenSkipped("skip-dependencies")
      .executes(() => {});
  }
  const b = new B();
  discoverTargets(b);
  assertEquals(b.main.cacheKeys_.length, 1);
  assertEquals(b.main.produces_, ["dist"]);
  assertEquals(b.main.dependsOn_.map((t) => t.name_), ["dep"]); // consumes
  assertEquals(b.main.always_, true);
  assertEquals(b.main.skipDependencies_, true);
});

Deno.test("timeout and retry record their configuration, clamping inputs", () => {
  const t = target().timeout(500).retry(3, 250).executes(() => {});
  assertEquals(t.timeout_, 500);
  assertEquals(t.retries_, 3);
  assertEquals(t.retryDelay_, 250);

  // Negative/fractional counts clamp to a sane non-negative integer; delay
  // defaults to 0.
  const u = target().retry(-2);
  assertEquals([u.retries_, u.retryDelay_], [0, 0]);
  const v = target().retry(2.9);
  assertEquals(v.retries_, 2);
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

Deno.test("executes accepts a body that returns a value", () => {
  // The DX regression: every *Tasks wrapper resolves to a CommandOutput, so
  // `.executes(() => DenoTasks.lint())` must type-check without an async
  // wrapper that exists only to discard the result.
  const sync = target().executes(() => 42);
  const wrapped = target().executes(() => Promise.resolve({ code: 0 }));
  assertEquals(typeof sync.fn_, "function");
  assertEquals(typeof wrapped.fn_, "function");
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

Deno.test("recoverWith records remediations; recoverAttempts defaults to 1", () => {
  const a = { remediate: () => ({ retry: false }) };
  const b = { remediate: () => ({ retry: true }) };
  const t = target().recoverWith(a).recoverWith(b);
  assertEquals(t.recoverWith_, [a, b]);
  assertEquals(t.recoverAttempts_, 1);
});

Deno.test("recoverAttempts clamps to at least 1 and floors fractions", () => {
  assertEquals(target().recoverAttempts(0).recoverAttempts_, 1);
  assertEquals(target().recoverAttempts(-5).recoverAttempts_, 1);
  assertEquals(target().recoverAttempts(2.9).recoverAttempts_, 2);
});
