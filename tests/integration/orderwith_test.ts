/**
 * Integration: `Build.orderWith` — the lazy, per-run soft-ordering provider
 * (M19 P2 #10) — driven through the real CLI `main()`. Unlike `extraEdges`, the
 * provider is `async` and evaluated when the run plans (it can read an external
 * dependency graph), and it is honoured both by a run and by `zuke cancel`'s
 * reverse-order compensation walk.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  externalSignal,
  FileSystemStateStore,
  type OrderingEdge,
  target,
} from "../../packages/core/mod.ts";
import type { TargetBuilder } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** A fake "load the dependency graph" step: async, resolves to `[before, after]` names. */
function loadDependencyGraph(): Promise<Array<[string, string]>> {
  return Promise.resolve([["web", "api"]]); // web must build before api
}

Deno.test("orderWith imposes lazy per-run ordering", async () => {
  const log: string[] = [];
  class Mono extends Build {
    web = target().executes(() => void log.push("web"));
    api = target().executes(() => void log.push("api"));
    all = target()
      .dependsOn(this.web, this.api)
      .executes(() => void log.push("all"));
    // Resolved at run time from an external graph — the opposite of the default
    // sibling order.
    override async orderWith(
      t: Map<string, TargetBuilder>,
    ): Promise<OrderingEdge[]> {
      const graph = await loadDependencyGraph();
      return graph.flatMap(([before, after]) => {
        const from = t.get(before), to = t.get(after);
        return from && to ? [[from, to] as OrderingEdge] : [];
      });
    }
  }
  const res = await runCli(Mono, ["all"]);
  assertEquals(res.code, 0);
  assertEquals(log.indexOf("web") < log.indexOf("api"), true);
});

Deno.test("orderWith and extraEdges merge into one edge set", async () => {
  const log: string[] = [];
  class Mono extends Build {
    a = target().executes(() => void log.push("a"));
    b = target().executes(() => void log.push("b"));
    c = target().executes(() => void log.push("c"));
    all = target()
      .dependsOn(this.a, this.b, this.c)
      .executes(() => {});
    // extraEdges: a → b (static).
    override extraEdges(t: Map<string, TargetBuilder>): OrderingEdge[] {
      const a = t.get("a"), b = t.get("b");
      return a && b ? [[a, b]] : [];
    }
    // orderWith: b → c (lazy). Together they chain a → b → c.
    override orderWith(t: Map<string, TargetBuilder>): OrderingEdge[] {
      const b = t.get("b"), c = t.get("c");
      return b && c ? [[b, c]] : [];
    }
  }
  const res = await runCli(Mono, ["all"]);
  assertEquals(res.code, 0);
  assertEquals(log.indexOf("a") < log.indexOf("b"), true);
  assertEquals(log.indexOf("b") < log.indexOf("c"), true);
});

Deno.test("orderWith warns about a dead edge to a target not in the build", async () => {
  class Mono extends Build {
    a = target().executes(() => {});
    all = target().dependsOn(this.a).executes(() => {});
    override orderWith(t: Map<string, TargetBuilder>): OrderingEdge[] {
      const a = t.get("a");
      // An ad-hoc target that is not a class field — never in the run or the
      // discovered set, so this edge can never apply. Mirrors the trap of
      // feeding a fan-out per-item name (which is not a class field) into
      // orderWith: the edge is dead, and used to be dropped silently.
      const ghost = target();
      return a ? [[a, ghost]] : [];
    }
  }
  const res = await runCli(Mono, ["all"]);
  assertEquals(res.code, 0); // the dead edge is ignored; the run still succeeds
  assertStringIncludes(res.out + res.err, "not a target in this build");
});

Deno.test("orderWith stays silent for a declared target simply not in this run", async () => {
  class Mono extends Build {
    a = target().executes(() => {});
    other = target().executes(() => {}); // a real target, but not reached by `all`
    all = target().dependsOn(this.a).executes(() => {});
    // `other` is a declared (conditional) target, legitimately ignored here — it
    // must NOT be flagged like the dangling ad-hoc target above.
    override extraEdges(t: Map<string, TargetBuilder>): OrderingEdge[] {
      const a = t.get("a"), other = t.get("other");
      return a && other ? [[a, other]] : [];
    }
  }
  const res = await runCli(Mono, ["all"]);
  assertEquals(res.code, 0);
  assertEquals(
    (res.out + res.err).includes("not a target in this build"),
    false,
  );
});

Deno.test("orderWith tolerates a malformed edge with a nullish endpoint (no crash)", async () => {
  class Mono extends Build {
    a = target().executes(() => {});
    all = target().dependsOn(this.a).executes(() => {});
    override orderWith(t: Map<string, TargetBuilder>): OrderingEdge[] {
      const a = t.get("a");
      if (!a) return [];
      // A consumer bypassing the OrderingEdge type to feed a nullish endpoint:
      // the run must tolerate it (like any out-of-set edge), never crash on it.
      // @ts-expect-error deliberately pass a nullish endpoint to exercise the guard
      return [[a, undefined]];
    }
  }
  const res = await runCli(Mono, ["all"]);
  assertEquals(res.code, 0); // tolerated, not a crash
});

Deno.test("a failing orderWith fails the run cleanly, not with an unhandled rejection", async () => {
  class B extends Build {
    a = target().executes(() => {});
    // The dependency-graph service is unreachable at plan time.
    override orderWith(): Promise<OrderingEdge[]> {
      return Promise.reject(new Error("dependency graph unavailable"));
    }
  }
  const res = await runCli(B, ["a"]);
  assertEquals(res.code, 1);
  assertStringIncludes(res.err, "Failed to resolve ordering edges");
  assertStringIncludes(res.err, "dependency graph unavailable");
});

Deno.test("out-of-process cancel unwinds in orderWith execution order", async () => {
  await withStateDir(async (dir) => {
    const log: string[] = [];
    class CD extends Build {
      web = target()
        .executes(() => void log.push("web"))
        .onCancel(() => this.webDown);
      api = target()
        .executes(() => void log.push("api"))
        .onCancel(() => this.apiDown);
      webDown = target().executes(() => void log.push("webDown"));
      apiDown = target().executes(() => void log.push("apiDown"));
      gate = target()
        .dependsOn(this.web, this.api)
        .waitsFor((s) => s.on(externalSignal("go")));
      done = target().dependsOn(this.gate).executes(() => {});
      // Lazy edge: web before api — so api is the "later" work, unwound first.
      override async orderWith(
        t: Map<string, TargetBuilder>,
      ): Promise<OrderingEdge[]> {
        await Promise.resolve();
        const web = t.get("web"), api = t.get("api");
        return web && api ? [[web, api]] : [];
      }
    }

    // Run to the gate: web then api succeed, then suspend.
    const first = await runCli(CD, ["done"]);
    assertEquals(first.code, 0);
    assertEquals(log, ["web", "api"]);
    const id =
      (await new FileSystemStateStore(dir, defaultStateHost).listRuns({}))[0]
        .id;

    // Cancel out-of-process: compensations run in reverse execution order, so
    // api (which ran after web, per the lazy edge) is unwound before web.
    const cancelled = await runCli(CD, ["cancel", id]);
    assertEquals(cancelled.code, 0);
    assertEquals(log.indexOf("apiDown") < log.indexOf("webDown"), true);
  });
});
