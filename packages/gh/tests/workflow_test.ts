import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import type {
  JsonValue,
  SignalRecord,
  TargetStateHandle,
  WaitContext,
} from "@zuke/core";
import {
  type GhWorkflowApi,
  githubWorkflow,
  githubWorkflowWith,
  readWorkflowResult,
  RestGhWorkflowApi,
  type WorkflowJob,
  type WorkflowRun,
} from "../src/workflow.ts";

/** The global `fetch` signature, aliased so a local can be annotated. */
type FetchFn = typeof globalThis.fetch;

const NO_SIGNALS: ReadonlyMap<string, SignalRecord> = new Map();

/** An in-memory {@link TargetStateHandle} for driving the trigger. */
function fakeState(
  initial: Record<string, JsonValue> = {},
): TargetStateHandle {
  let meta: Record<string, JsonValue> = { ...initial };
  return {
    get: () => meta,
    set: (patch) => {
      meta = { ...meta, ...patch };
      return Promise.resolve();
    },
  };
}

/** A wait context over a fresh fake state handle. */
function ctx(state: TargetStateHandle): WaitContext {
  return { state, runId: "r1", target: "e2e" };
}

/** A scripted {@link GhWorkflowApi} whose run status/conclusion the test drives. */
class ScriptedApi implements GhWorkflowApi {
  dispatches: Array<{ ref: string; inputs: Record<string, string> }> = [];
  status = "in_progress";
  conclusion: string | null = null;
  appears = true; // whether findRun can locate the dispatched run
  jobs: WorkflowJob[] = [
    { name: "build", conclusion: "success", url: "https://gh/j1" },
  ];

  dispatch(
    _repo: string,
    _workflow: string,
    ref: string,
    inputs: Record<string, string>,
  ): Promise<void> {
    this.dispatches.push({ ref, inputs });
    return Promise.resolve();
  }
  findRun(): Promise<WorkflowRun | null> {
    return Promise.resolve(
      this.appears
        ? {
          id: 100,
          status: this.status,
          conclusion: this.conclusion,
          url: "https://gh/r100",
        }
        : null,
    );
  }
  getRun(): Promise<WorkflowRun> {
    return Promise.resolve({
      id: 100,
      status: this.status,
      conclusion: this.conclusion,
      url: "https://gh/r100",
    });
  }
  listJobs(): Promise<WorkflowJob[]> {
    return Promise.resolve(this.jobs);
  }
}

Deno.test("githubWorkflow requires a repo and a workflow", () => {
  assertThrows(() => githubWorkflow((g) => g), Error, "repo and a workflow");
  assertThrows(
    () => githubWorkflow((g) => g.repo("acme/app")),
    Error,
    "repo and a workflow",
  );
});

Deno.test("descriptor and poll interval reflect the settings", () => {
  const trigger = githubWorkflow((g) =>
    g.repo("acme/app").workflow("e2e.yml").pollEvery("30s")
  );
  assertEquals(trigger.descriptor, "github:acme/app:e2e.yml");
  assertEquals(trigger.pollIntervalMs, 30_000);
});

Deno.test("first evaluation dispatches with a marker and suspends", async () => {
  const api = new ScriptedApi();
  const state = fakeState();
  const trigger = githubWorkflowWith(
    (g) =>
      g.repo("acme/app").workflow("e2e.yml").ref("release").input(
        "env",
        "prod",
      ),
    { api },
  );
  assertEquals(await trigger.isSatisfied(NO_SIGNALS, ctx(state)), false);
  assertEquals(api.dispatches.length, 1);
  assertEquals(api.dispatches[0].ref, "release");
  assertEquals(api.dispatches[0].inputs.env, "prod");
  assertEquals(api.dispatches[0].inputs.zuke_marker, "zuke:r1:e2e");
});

Deno.test("polls until the run completes, then records the per-job result", async () => {
  const api = new ScriptedApi();
  const state = fakeState();
  const trigger = githubWorkflowWith(
    (g) => g.repo("acme/app").workflow("e2e.yml"),
    { api },
  );
  const c = ctx(state);

  // Dispatch, then a poll while still running.
  assertEquals(await trigger.isSatisfied(NO_SIGNALS, c), false); // dispatch
  assertEquals(await trigger.isSatisfied(NO_SIGNALS, c), false); // in_progress
  assertEquals(api.dispatches.length, 1); // never re-dispatches

  // Completes successfully.
  api.status = "completed";
  api.conclusion = "success";
  assertEquals(await trigger.isSatisfied(NO_SIGNALS, c), true);

  const result = readWorkflowResult(state);
  assertEquals(result?.passed, true);
  assertEquals(result?.conclusion, "success");
  assertEquals(result?.runId, 100);
  assertEquals(result?.jobs, [
    { name: "build", conclusion: "success", url: "https://gh/j1" },
  ]);
});

Deno.test("a failed run yields passed:false", async () => {
  const api = new ScriptedApi();
  api.status = "completed";
  api.conclusion = "failure";
  const state = fakeState();
  const trigger = githubWorkflowWith((g) => g.repo("a/b").workflow("w"), {
    api,
  });
  const c = ctx(state);
  await trigger.isSatisfied(NO_SIGNALS, c); // dispatch
  assertEquals(await trigger.isSatisfied(NO_SIGNALS, c), true);
  assertEquals(readWorkflowResult(state)?.passed, false);
});

Deno.test("waits for the run to appear before polling it", async () => {
  const api = new ScriptedApi();
  api.appears = false;
  const state = fakeState();
  const trigger = githubWorkflowWith((g) => g.repo("a/b").workflow("w"), {
    api,
  });
  const c = ctx(state);
  await trigger.isSatisfied(NO_SIGNALS, c); // dispatch
  assertEquals(await trigger.isSatisfied(NO_SIGNALS, c), false); // not found yet
});

Deno.test("a transient poll error re-suspends instead of failing the run", async () => {
  let failJobs = true;
  const api: GhWorkflowApi = {
    dispatch: () => Promise.resolve(),
    findRun: () =>
      Promise.resolve({
        id: 100,
        status: "completed",
        conclusion: "success",
        url: "u",
      }),
    getRun: () =>
      Promise.resolve({
        id: 100,
        status: "completed",
        conclusion: "success",
        url: "u",
      }),
    listJobs: () =>
      failJobs
        ? Promise.reject(new Error("gh workflow: GET /jobs → 502"))
        : Promise.resolve([{ name: "build", conclusion: "success", url: "j" }]),
  };
  const state = fakeState();
  const trigger = githubWorkflowWith((g) => g.repo("a/b").workflow("w"), {
    api,
  });
  const c = ctx(state);
  await trigger.isSatisfied(NO_SIGNALS, c); // dispatch
  // The run completed, but listJobs throws transiently: stay suspended, not fail.
  assertEquals(await trigger.isSatisfied(NO_SIGNALS, c), false);
  assertEquals(readWorkflowResult(state), undefined); // nothing recorded yet
  // The blip clears: the next check completes and records the result.
  failJobs = false;
  assertEquals(await trigger.isSatisfied(NO_SIGNALS, c), true);
  assertEquals(readWorkflowResult(state)?.passed, true);
});

Deno.test("a satisfied wait stays satisfied and never re-dispatches", async () => {
  const api = new ScriptedApi();
  api.status = "completed";
  api.conclusion = "success";
  const state = fakeState();
  const trigger = githubWorkflowWith((g) => g.repo("a/b").workflow("w"), {
    api,
  });
  const c = ctx(state);
  await trigger.isSatisfied(NO_SIGNALS, c); // dispatch
  assertEquals(await trigger.isSatisfied(NO_SIGNALS, c), true); // completes
  assertEquals(await trigger.isSatisfied(NO_SIGNALS, c), true); // idempotent
  assertEquals(api.dispatches.length, 1);
});

Deno.test("inputs() and markerInput() feed the dispatch", async () => {
  const api = new ScriptedApi();
  const trigger = githubWorkflowWith(
    (g) =>
      g.repo("a/b").workflow("w").inputs({ env: "prod" }).markerInput("mark"),
    { api },
  );
  await trigger.isSatisfied(NO_SIGNALS, ctx(fakeState()));
  assertEquals(api.dispatches[0].inputs.env, "prod");
  assertEquals(api.dispatches[0].inputs.mark, "zuke:r1:e2e"); // custom marker input
  assertEquals(api.dispatches[0].inputs.zuke_marker, undefined);
});

Deno.test("readWorkflowResult returns undefined until the wait completes", () => {
  assertEquals(readWorkflowResult(fakeState()), undefined);
  assertEquals(
    readWorkflowResult(fakeState({ githubWorkflow: { dispatched: true } })),
    undefined,
  );
  // A malformed result (missing fields) is rejected, not partially returned.
  assertEquals(
    readWorkflowResult(
      fakeState({ githubWorkflow: { result: { passed: true } } }),
    ),
    undefined,
  );
});

Deno.test("readWorkflowResult tolerates malformed jobs", () => {
  const state = fakeState({
    githubWorkflow: {
      result: {
        runId: 1,
        conclusion: "success",
        url: "u",
        passed: true,
        jobs: [null, { name: "x" }],
      },
    },
  });
  // A non-object job is skipped; missing string fields default to "".
  assertEquals(readWorkflowResult(state)?.jobs, [
    { name: "x", conclusion: "", url: "" },
  ]);
});

// --- The default REST transport, over a fake fetch --------------------------

/** A fake `fetch` routing by `METHOD url` to a canned JSON response. */
function routerFetch(
  routes: Record<string, unknown>,
): { fetch: FetchFn; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: FetchFn = (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const key = `${init?.method ?? "GET"} ${url}`;
    const body = routes[key];
    if (body === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200 }),
    );
  };
  return { fetch, calls };
}

Deno.test("RestGhWorkflowApi.dispatch POSTs ref+inputs with auth", async () => {
  const { fetch, calls } = routerFetch({
    "POST https://api.github.com/repos/a/b/actions/workflows/w.yml/dispatches":
      {},
  });
  const api = new RestGhWorkflowApi({ fetch, token: "t0ken" });
  await api.dispatch("a/b", "w.yml", "main", { zuke_marker: "m" });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].init?.method, "POST");
  assertEquals(
    new Headers(calls[0].init?.headers).get("authorization"),
    "Bearer t0ken",
  );
  assertEquals(
    calls[0].init?.body,
    JSON.stringify({ ref: "main", inputs: { zuke_marker: "m" } }),
  );
});

Deno.test("RestGhWorkflowApi.findRun matches the run by display title", async () => {
  const { fetch } = routerFetch({
    "GET https://api.github.com/repos/a/b/actions/workflows/w.yml/runs?per_page=100&page=1":
      {
        workflow_runs: [
          {
            id: 1,
            display_title: "other",
            status: "completed",
            html_url: "u1",
          },
          {
            id: 2,
            display_title: "zuke:r1:e2e",
            status: "in_progress",
            conclusion: null,
            html_url: "u2",
          },
        ],
      },
  });
  const api = new RestGhWorkflowApi({ fetch });
  const run = await api.findRun("a/b", "w.yml", "zuke:r1:e2e");
  assertEquals(run?.id, 2);
  assertEquals(run?.url, "u2");
});

Deno.test("RestGhWorkflowApi.findRun returns null when no run matches", async () => {
  const { fetch } = routerFetch({
    "GET https://api.github.com/repos/a/b/actions/workflows/w.yml/runs?per_page=100&page=1":
      {
        workflow_runs: [],
      },
  });
  const api = new RestGhWorkflowApi({ fetch });
  assertEquals(await api.findRun("a/b", "w.yml", "m"), null);
});

Deno.test("RestGhWorkflowApi.getRun and listJobs map the GitHub shape", async () => {
  const { fetch } = routerFetch({
    "GET https://api.github.com/repos/a/b/actions/runs/9": {
      id: 9,
      status: "completed",
      conclusion: "success",
      html_url: "run-url",
    },
    "GET https://api.github.com/repos/a/b/actions/runs/9/jobs": {
      jobs: [{ name: "unit", conclusion: "failure", html_url: "job-url" }],
    },
  });
  const api = new RestGhWorkflowApi({ fetch });
  const run = await api.getRun("a/b", 9);
  assertEquals(run, {
    id: 9,
    status: "completed",
    conclusion: "success",
    url: "run-url",
  });
  const jobs = await api.listJobs("a/b", 9);
  assertEquals(jobs, [{ name: "unit", conclusion: "failure", url: "job-url" }]);
});

Deno.test("RestGhWorkflowApi throws on a non-2xx GET", async () => {
  const { fetch } = routerFetch({}); // every route 404s
  const api = new RestGhWorkflowApi({ fetch });
  await assertRejects(() => api.getRun("a/b", 1), Error, "404");
});

Deno.test("RestGhWorkflowApi.dispatch throws on a non-2xx", async () => {
  const { fetch } = routerFetch({}); // dispatch route 404s
  const api = new RestGhWorkflowApi({ fetch });
  await assertRejects(
    () => api.dispatch("a/b", "w.yml", "main", {}),
    Error,
    "dispatch",
  );
});

Deno.test("RestGhWorkflowApi.findRun tolerates a malformed runs payload", async () => {
  const base =
    "https://api.github.com/repos/a/b/actions/workflows/w.yml/runs?per_page=100&page=1";
  const notArray = routerFetch({ [`GET ${base}`]: { workflow_runs: "nope" } });
  assertEquals(
    await new RestGhWorkflowApi({ fetch: notArray.fetch }).findRun(
      "a/b",
      "w.yml",
      "m",
    ),
    null,
  );
  const withJunk = routerFetch({
    [`GET ${base}`]: {
      workflow_runs: [null, 5, {
        id: 3,
        display_title: "m",
        status: "queued",
        html_url: "u",
      }],
    },
  });
  assertEquals(
    (await new RestGhWorkflowApi({ fetch: withJunk.fetch }).findRun(
      "a/b",
      "w.yml",
      "m",
    ))?.id,
    3,
  );
});

Deno.test("RestGhWorkflowApi.findRun paginates to a run beyond the first page", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    display_title: `noise-${i}`,
    status: "completed",
    conclusion: "success",
    html_url: `u${i}`,
  }));
  const w = "https://api.github.com/repos/a/b/actions/workflows/w.yml/runs";
  const { fetch } = routerFetch({
    [`GET ${w}?per_page=100&page=1`]: { workflow_runs: page1 },
    [`GET ${w}?per_page=100&page=2`]: {
      workflow_runs: [{
        id: 999,
        display_title: "zuke:r1:e2e",
        status: "in_progress",
        conclusion: null,
        html_url: "u999",
      }],
    },
  });
  const run = await new RestGhWorkflowApi({ fetch }).findRun(
    "a/b",
    "w.yml",
    "zuke:r1:e2e",
  );
  assertEquals(run?.id, 999); // found on page 2, not just the first 100
});

Deno.test("RestGhWorkflowApi aborts a hung request via its timeout", async () => {
  // A fetch that never resolves on its own but honours the AbortSignal.
  const hung: FetchFn = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
      );
    });
  const api = new RestGhWorkflowApi({
    fetch: hung,
    base: "https://api.test",
    timeoutMs: 5,
  });
  await assertRejects(() => api.getRun("a/b", 1)); // aborts, does not hang
});

Deno.test("RestGhWorkflowApi maps missing run/job fields to defaults", async () => {
  const { fetch } = routerFetch({
    "GET https://api.github.com/repos/a/b/actions/runs/9": {}, // no fields
    "GET https://api.github.com/repos/a/b/actions/runs/9/jobs": {
      jobs: [null, {}],
    },
  });
  const api = new RestGhWorkflowApi({ fetch });
  assertEquals(await api.getRun("a/b", 9), {
    id: 0,
    status: "unknown",
    conclusion: null,
    url: "",
  });
  // The null job is skipped; the empty job defaults every field.
  assertEquals(await api.listJobs("a/b", 9), [{
    name: "",
    conclusion: "",
    url: "",
  }]);
});
