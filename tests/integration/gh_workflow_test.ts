/**
 * Integration: a `.waitsFor(githubWorkflow(...))` gate driven through the real
 * CLI. The GitHub API is a fake, but the executor, the durable state writer, the
 * suspend, and the `resume --check` re-evaluation are all real — so this proves
 * the core `WaitContext` seam: the trigger dispatches on first reach, persists
 * its correlation state, suspends, and a later resume reads that state back and
 * completes without re-dispatching.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import type {
  GhWorkflowApi,
  WorkflowJob,
  WorkflowRun,
} from "../../packages/gh/src/workflow.ts";
import {
  githubWorkflowWith,
  readWorkflowResult,
} from "../../packages/gh/src/workflow.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** A fake GitHub API whose run status/conclusion (and a transient error) the test drives. */
class FakeApi implements GhWorkflowApi {
  status = "in_progress";
  conclusion: string | null = null;
  dispatched = 0;
  throwOnGetRun = false;
  appears = true; // whether the dispatched run can be correlated

  #run(): WorkflowRun {
    return {
      id: 55,
      status: this.status,
      conclusion: this.conclusion,
      url: "u",
      createdAt: "2026-07-19T00:00:05.000Z",
      headBranch: "main",
    };
  }

  dispatch(): Promise<void> {
    this.dispatched++;
    return Promise.resolve();
  }
  findRun(): Promise<WorkflowRun | null> {
    return Promise.resolve(this.appears ? this.#run() : null);
  }
  recentRuns(): Promise<WorkflowRun[]> {
    return Promise.resolve(this.appears ? [this.#run()] : []);
  }
  getRun(): Promise<WorkflowRun> {
    if (this.throwOnGetRun) {
      return Promise.reject(new Error("gh workflow: GET /runs/55 → 502"));
    }
    return Promise.resolve(this.#run());
  }
  listJobs(): Promise<WorkflowJob[]> {
    return Promise.resolve([
      { name: "e2e", conclusion: this.conclusion ?? "", url: "j" },
    ]);
  }
}

Deno.test("a githubWorkflow gate dispatches, suspends, then resumes on completion", async () => {
  await withStateDir(async (dir) => {
    const api = new FakeApi();
    const log: string[] = [];
    class Ship extends Build {
      e2e = target().waitsFor((s) =>
        s.on(
          githubWorkflowWith(
            (g) => g.repo("acme/app").workflow("e2e.yml"),
            { api },
          ),
        )
      );
      ship = target().dependsOn(this.e2e).executes((ctx) => {
        // Read the gate target's published result via stateOf.
        const result = readWorkflowResult(ctx.stateOf("e2e"));
        log.push(`ship:passed=${result?.passed}`);
      });
    }

    // First process: reach the gate, dispatch, suspend (exit 0).
    const first = await runCli(Ship, ["ship"]);
    assertEquals(first.code, 0);
    assertEquals(log, []); // ship did not run
    assertEquals(api.dispatched, 1);
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const runs = await store.listRuns({});
    assertEquals(runs.length, 1);
    const id = runs[0].id;
    assertEquals(runs[0].status, "suspended");

    // The external workflow finishes; a resume --check re-evaluates the gate.
    api.status = "completed";
    api.conclusion = "success";
    const resumed = await runCli(Ship, ["resume", id, "--check"]);
    assertEquals(resumed.code, 0);
    assertEquals(log, ["ship:passed=true"]);
    assertEquals(api.dispatched, 1); // never re-dispatched across the resume
    assertEquals(
      await store.getRun(id).then((g) => g?.record.status),
      "succeeded",
    );
  });
});

Deno.test("a githubWorkflow gate fails fast when the run never correlates", async () => {
  await withStateDir(async (dir) => {
    const api = new FakeApi();
    api.appears = false; // the target workflow never echoes the marker
    let t = Date.parse("2026-07-19T00:00:00.000Z");
    const now = () => t;
    class Ship extends Build {
      e2e = target().waitsFor((s) =>
        s.on(
          githubWorkflowWith(
            (g) =>
              g.repo("acme/app").workflow("e2e.yml").discoveryTimeout("60s"),
            { api, now },
          ),
        )
      );
      ship = target().dependsOn(this.e2e).executes(() => {});
    }

    // First process: dispatch + suspend.
    const first = await runCli(Ship, ["ship"]);
    assertEquals(first.code, 0);
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const id = (await store.listRuns({}))[0].id;
    assertEquals((await store.getRun(id))?.record.status, "suspended");

    // Advance past the discovery window; the resume fails fast (not a timeout).
    t += 61_000;
    const resumed = await runCli(Ship, ["resume", id, "--check"]);
    assertEquals(resumed.code, 1);
    assertEquals((await store.getRun(id))?.record.status, "failed");
  });
});

Deno.test("a transient GitHub error during a resume poll re-suspends, never strands the run", async () => {
  await withStateDir(async (dir) => {
    const api = new FakeApi();
    const log: string[] = [];
    class Ship extends Build {
      e2e = target().waitsFor((s) =>
        s.on(
          githubWorkflowWith(
            (g) => g.repo("acme/app").workflow("e2e.yml"),
            { api },
          ),
        )
      );
      ship = target().dependsOn(this.e2e).executes((ctx) => {
        log.push(
          `ship:passed=${readWorkflowResult(ctx.stateOf("e2e"))?.passed}`,
        );
      });
    }

    const first = await runCli(Ship, ["ship"]); // dispatch + suspend
    assertEquals(first.code, 0);
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const id = (await store.listRuns({}))[0].id;

    // A transient 502 on the poll must NOT terminate the run — it stays suspended.
    api.throwOnGetRun = true;
    await runCli(Ship, ["resume", id, "--check"]);
    assertEquals(
      await store.getRun(id).then((g) => g?.record.status),
      "suspended",
    );

    // GitHub recovers and the workflow completes: the run resumes and ships.
    api.throwOnGetRun = false;
    api.status = "completed";
    api.conclusion = "success";
    await runCli(Ship, ["resume", id, "--check"]);
    assertEquals(
      await store.getRun(id).then((g) => g?.record.status),
      "succeeded",
    );
    assertEquals(log, ["ship:passed=true"]);
  });
});
