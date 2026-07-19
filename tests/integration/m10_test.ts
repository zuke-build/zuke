/**
 * Integration: the two M10 features driven through the real CLI `main()`.
 *
 * - `Build.extraEdges` imposes consumer-supplied soft ordering on the plan.
 * - `.dryRunnable()` runs a target's body under `--dry-run` with `$` in echo
 *   mode, while ordinary targets stay skipped.
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
import { $ } from "../../packages/core/src/shell.ts";
import { runCli, withStateDir } from "./_harness.ts";

Deno.test("extraEdges imposes consumer-supplied ordering", async () => {
  const log: string[] = [];
  class Mono extends Build {
    web = target().executes(() => void log.push("web"));
    api = target().executes(() => void log.push("api"));
    all = target()
      .dependsOn(this.web, this.api)
      .executes(() => void log.push("all"));
    // Force `web` before `api` — the opposite of the default sibling order —
    // as if fed from an external dependency graph.
    override extraEdges(t: Map<string, TargetBuilder>): OrderingEdge[] {
      const web = t.get("web");
      const api = t.get("api");
      return web && api ? [[web, api]] : [];
    }
  }
  const res = await runCli(Mono, ["all"]);
  assertEquals(res.code, 0);
  assertEquals(log.indexOf("web") < log.indexOf("api"), true);
});

Deno.test("dryRunnable runs the body with $ echoed; other targets stay skipped", async () => {
  const ran: string[] = [];
  class B extends Build {
    normal = target().executes(() => void ran.push("normal"));
    preview = target().dryRunnable().executes(async () => {
      ran.push("preview-body");
      await $`echo hello world`; // echoed, not spawned, under a deep dry run
    });
    all = target()
      .dependsOn(this.normal, this.preview)
      .executes(() => void ran.push("all"));
  }
  const res = await runCli(B, ["all", "--dry-run"]);
  assertEquals(res.code, 0);
  // The dryRunnable body ran and its command was echoed…
  assertEquals(ran.includes("preview-body"), true);
  assertStringIncludes(res.out, "$ echo hello world");
  // …while ordinary targets were skipped (their bodies never ran).
  assertEquals(ran.includes("normal"), false);
  assertEquals(ran.includes("all"), false);
});

Deno.test("a dryRunnable body that throws fails the target under --dry-run", async () => {
  class B extends Build {
    preview = target().dryRunnable().executes(() => {
      throw new Error("preview boom");
    });
  }
  const res = await runCli(B, ["preview", "--dry-run"]);
  assertEquals(res.code, 1);
  assertStringIncludes(res.err, "preview boom");
});

Deno.test("out-of-process cancel unwinds in extraEdges execution order", async () => {
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
      // Force web before api — so api is the "later" work, unwound first.
      override extraEdges(t: Map<string, TargetBuilder>): OrderingEdge[] {
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
    // api (which ran after web) is unwound before web.
    const cancelled = await runCli(CD, ["cancel", id]);
    assertEquals(cancelled.code, 0);
    assertEquals(log.indexOf("apiDown") < log.indexOf("webDown"), true);
  });
});
