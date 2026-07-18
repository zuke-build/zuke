/**
 * {@link githubWorkflow} — a Zuke {@link "@zuke/core".WaitTrigger} that
 * dispatches a GitHub Actions workflow (often in **another repo**), suspends the
 * run until it finishes, and resurfaces its per-job conclusions to the target's
 * body. It replaces the hand-rolled "dispatch, then poll `gh run list`" glue.
 *
 * Used inside a `.waitsFor(...)` gate:
 *
 * ```ts
 * import { Build, run, target } from "jsr:@zuke/core";
 * import { githubWorkflow, readWorkflowResult } from "jsr:@zuke/gh";
 *
 * class Release extends Build {
 *   e2e = target().waitsFor((s) =>
 *     s.on(
 *       githubWorkflow((g) =>
 *         g.repo("acme/app").workflow("e2e.yml").ref("main")
 *       ),
 *     ).timeout("2h").onTimeout(() => this.rollback)
 *   );
 *   ship = target().dependsOn(this.e2e).executes((ctx) => {
 *     // The result lives on the gate target's state — read it via stateOf.
 *     const result = readWorkflowResult(ctx.stateOf("e2e"));
 *     if (!result?.passed) throw new Error("e2e suite failed");
 *   });
 *   rollback = target().executes(() => rollBack());
 * }
 * ```
 *
 * **Correlation.** GitHub's `workflow_dispatch` API returns no run id, so the
 * trigger dispatches with a marker input (default `zuke_marker`) and finds the
 * run by matching that marker against the run's display title. The dispatched
 * workflow must echo the marker into its `run-name` for this to work:
 *
 * ```yaml
 * on: { workflow_dispatch: { inputs: { zuke_marker: { required: false } } } }
 * run-name: ${{ inputs.zuke_marker }}
 * ```
 *
 * The marker (`zuke:<runId>:<target>`) and the resolved run id are persisted in
 * the awaiting target's durable state, so a resume in a **different process**
 * never re-dispatches — it polls the run it already started.
 *
 * **Auth & testing.** The default transport calls the GitHub REST API with
 * `fetch`, authenticated by `GH_TOKEN` / `GITHUB_TOKEN`. The transport is an
 * injectable seam ({@link GhWorkflowApi}), so tests drive the whole state
 * machine with a fake — no network, no real GitHub.
 *
 * @module
 */

import type {
  JsonValue,
  SignalRecord,
  TargetStateHandle,
  WaitContext,
  WaitTrigger,
} from "@zuke/core";
import { parseDuration } from "@zuke/core";

/** One job's outcome within a completed workflow run. */
export interface WorkflowJob {
  /** The job's name. */
  name: string;
  /** Its conclusion (`success`, `failure`, `cancelled`, `skipped`, …). */
  conclusion: string;
  /** A link to the job on GitHub. */
  url: string;
}

/**
 * The payload a completed {@link githubWorkflow} wait writes to the awaiting
 * target's state; read it in a dependent body with {@link readWorkflowResult}.
 */
export interface WorkflowResult {
  /** True when the run's overall conclusion was `success`. */
  passed: boolean;
  /** The run's overall conclusion. */
  conclusion: string;
  /** The dispatched run's numeric id. */
  runId: number;
  /** A link to the run on GitHub. */
  url: string;
  /** Each job's conclusion, so a build can branch on which suite failed. */
  jobs: WorkflowJob[];
}

/** A workflow run's current state, as returned by a {@link GhWorkflowApi}. */
export interface WorkflowRun {
  /** The run's numeric id. */
  id: number;
  /** Its lifecycle status (`queued`, `in_progress`, `completed`). */
  status: string;
  /** Its conclusion once completed, else `null`. */
  conclusion: string | null;
  /** A link to the run on GitHub. */
  url: string;
}

/**
 * The slice of the GitHub Actions API {@link githubWorkflow} needs, behind an
 * interface so tests inject a fake and the trigger stays transport-agnostic.
 */
export interface GhWorkflowApi {
  /** Dispatch `workflow` in `repo` on `ref` with `inputs` (a `workflow_dispatch`). */
  dispatch(
    repo: string,
    workflow: string,
    ref: string,
    inputs: Record<string, string>,
  ): Promise<void>;
  /** The most recent run of `workflow` whose display title equals `marker`, or `null`. */
  findRun(
    repo: string,
    workflow: string,
    marker: string,
  ): Promise<WorkflowRun | null>;
  /** The current state of run `runId`. */
  getRun(repo: string, runId: number): Promise<WorkflowRun>;
  /** The jobs of run `runId`. */
  listJobs(repo: string, runId: number): Promise<WorkflowJob[]>;
}

/**
 * Configuration for {@link githubWorkflow}, set through a settings lambda. Every
 * setter returns `this` so calls chain; `repo` and `workflow` are required.
 */
export class GithubWorkflowSettings {
  /** The `OWNER/REPO` slug the workflow lives in. */
  repo_?: string;
  /** The workflow file name (e.g. `e2e.yml`) or its numeric id. */
  workflow_?: string;
  /** The git ref to dispatch against (default `main`). */
  ref_ = "main";
  /** Extra `workflow_dispatch` inputs. */
  inputs_: Record<string, string> = {};
  /** The input name the marker is passed as (default `zuke_marker`). */
  markerInput_ = "zuke_marker";
  /** Poll interval hint (ms) for `zuke resume --check`. */
  pollIntervalMs_?: number;

  /** Set the `OWNER/REPO` the workflow lives in. */
  repo(slug: string): this {
    this.repo_ = slug;
    return this;
  }

  /** Set the workflow file name (e.g. `e2e.yml`) or numeric id. */
  workflow(idOrFile: string): this {
    this.workflow_ = idOrFile;
    return this;
  }

  /** Set the git ref to dispatch against (default `main`). */
  ref(ref: string): this {
    this.ref_ = ref;
    return this;
  }

  /** Add one `workflow_dispatch` input. */
  input(name: string, value: string): this {
    this.inputs_[name] = value;
    return this;
  }

  /** Merge a map of `workflow_dispatch` inputs. */
  inputs(map: Record<string, string>): this {
    Object.assign(this.inputs_, map);
    return this;
  }

  /** Change the input name the correlation marker is dispatched as. */
  markerInput(name: string): this {
    this.markerInput_ = name;
    return this;
  }

  /** Set how often `zuke resume --check` should re-poll (a duration string). */
  pollEvery(duration: string): this {
    this.pollIntervalMs_ = parseDuration(duration);
    return this;
  }
}

/** Narrow a {@link JsonValue} to a JSON object, else `undefined`. */
function asRecord(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value;
}

/** Read a string field of a JSON object, or `undefined`. */
function readStr(
  object: Record<string, JsonValue>,
  key: string,
): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

/** Read a number field of a JSON object, or `undefined`. */
function readNum(
  object: Record<string, JsonValue>,
  key: string,
): number | undefined {
  const value = object[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Read the {@link WorkflowResult} a completed {@link githubWorkflow} wait wrote
 * to a target's state, or `undefined` if the wait has not completed (or this is
 * not a github-workflow gate). Call it from a **dependent** target's body with
 * the gate's handle: `readWorkflowResult(ctx.stateOf("<gate-target>"))`.
 */
export function readWorkflowResult(
  state: TargetStateHandle,
): WorkflowResult | undefined {
  const entry = asRecord(state.get()[STATE_KEY]);
  const result = entry === undefined ? undefined : asRecord(entry.result);
  if (result === undefined) return undefined;
  const runId = readNum(result, "runId");
  const conclusion = readStr(result, "conclusion");
  const url = readStr(result, "url");
  if (runId === undefined || conclusion === undefined || url === undefined) {
    return undefined;
  }
  const rawJobs = result.jobs;
  const jobs: WorkflowJob[] = [];
  if (Array.isArray(rawJobs)) {
    for (const raw of rawJobs) {
      const job = asRecord(raw);
      if (job === undefined) continue;
      jobs.push({
        name: readStr(job, "name") ?? "",
        conclusion: readStr(job, "conclusion") ?? "",
        url: readStr(job, "url") ?? "",
      });
    }
  }
  return { passed: result.passed === true, conclusion, runId, url, jobs };
}

/** The key the trigger's durable correlation state lives under in target meta. */
const STATE_KEY = "githubWorkflow";

/** Serialise the trigger's correlation state to a JSON patch for `state.set`. */
function persist(
  state: TargetStateHandle,
  data: {
    marker: string;
    runId?: number;
    result?: WorkflowResult;
  },
): Promise<void> {
  const value: Record<string, JsonValue> = {
    dispatched: true,
    marker: data.marker,
  };
  if (data.runId !== undefined) value.runId = data.runId;
  if (data.result !== undefined) {
    value.done = true;
    value.result = {
      passed: data.result.passed,
      conclusion: data.result.conclusion,
      runId: data.result.runId,
      url: data.result.url,
      jobs: data.result.jobs.map((j) => ({
        name: j.name,
        conclusion: j.conclusion,
        url: j.url,
      })),
    };
  }
  return state.set({ [STATE_KEY]: value });
}

/** Read a JSON header value from the environment (`GH_TOKEN`, then `GITHUB_TOKEN`). */
function resolveToken(
  readEnv: (name: string) => string | undefined,
): string | undefined {
  return readEnv("GH_TOKEN") ?? readEnv("GITHUB_TOKEN");
}

/** The GitHub REST base, overridable for tests/GHES. */
const API_BASE = "https://api.github.com";

/** The default per-request timeout (ms) — a hung GitHub call must not wedge a poll. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** How many pages of `per_page=100` runs `findRun` scans before giving up. */
const MAX_RUN_PAGES = 5;

/** The default {@link GhWorkflowApi}: the GitHub REST API over `fetch`. */
export class RestGhWorkflowApi implements GhWorkflowApi {
  readonly #fetch: typeof fetch;
  readonly #token: string | undefined;
  readonly #base: string;
  readonly #timeoutMs: number;

  /** Build the transport from a `fetch` seam, a token, and options. */
  constructor(
    options: {
      fetch?: typeof fetch;
      token?: string;
      base?: string;
      timeoutMs?: number;
    } = {},
  ) {
    this.#fetch = options.fetch ?? fetch;
    this.#token = options.token;
    this.#base = options.base ?? API_BASE;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** The headers every request carries (auth + the pinned API version). */
  #headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "accept": "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    };
    if (this.#token !== undefined) {
      headers.authorization = `Bearer ${this.#token}`;
    }
    return headers;
  }

  /**
   * Run `fn` with an {@link AbortSignal} that fires after the request timeout, so
   * a GitHub endpoint that accepts the connection but never responds aborts
   * rather than hanging a `resume --check` sweep forever. A manual controller +
   * cleared timer (not `AbortSignal.timeout`) so no timer lingers past the call.
   */
  async #withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET a JSON body, throwing on a non-2xx response (bounded by the timeout). */
  #get(path: string): Promise<Record<string, JsonValue>> {
    return this.#withTimeout(async (signal) => {
      const response = await this.#fetch(`${this.#base}${path}`, {
        headers: this.#headers(),
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`gh workflow: GET ${path} → ${response.status}`);
      }
      return asRecord(await response.json()) ?? {};
    });
  }

  /** Dispatch a `workflow_dispatch` event (bounded by the timeout). */
  dispatch(
    repo: string,
    workflow: string,
    ref: string,
    inputs: Record<string, string>,
  ): Promise<void> {
    const path = `/repos/${repo}/actions/workflows/${workflow}/dispatches`;
    return this.#withTimeout(async (signal) => {
      const response = await this.#fetch(`${this.#base}${path}`, {
        method: "POST",
        headers: { ...this.#headers(), "content-type": "application/json" },
        body: JSON.stringify({ ref, inputs }),
        signal,
      });
      await response.body?.cancel();
      if (!response.ok) {
        throw new Error(
          `gh workflow: dispatch ${workflow} → ${response.status}`,
        );
      }
    });
  }

  /**
   * Find the newest run of `workflow` whose display title equals `marker`,
   * paginating so a run that has scrolled past the first page in a busy repo is
   * still correlated (up to {@link MAX_RUN_PAGES} pages of 100).
   */
  async findRun(
    repo: string,
    workflow: string,
    marker: string,
  ): Promise<WorkflowRun | null> {
    for (let page = 1; page <= MAX_RUN_PAGES; page++) {
      const body = await this.#get(
        `/repos/${repo}/actions/workflows/${workflow}/runs?per_page=100&page=${page}`,
      );
      const runs = body.workflow_runs;
      if (!Array.isArray(runs)) return null;
      for (const raw of runs) {
        const run = asRecord(raw);
        if (run === undefined) continue;
        if (readStr(run, "display_title") === marker) return toRun(run);
      }
      if (runs.length < 100) break; // last page reached
    }
    return null;
  }

  /** Fetch a run's current state. */
  async getRun(repo: string, runId: number): Promise<WorkflowRun> {
    return toRun(await this.#get(`/repos/${repo}/actions/runs/${runId}`));
  }

  /** List a run's jobs. */
  async listJobs(repo: string, runId: number): Promise<WorkflowJob[]> {
    const body = await this.#get(`/repos/${repo}/actions/runs/${runId}/jobs`);
    const rawJobs = body.jobs;
    const jobs: WorkflowJob[] = [];
    if (Array.isArray(rawJobs)) {
      for (const raw of rawJobs) {
        const job = asRecord(raw);
        if (job === undefined) continue;
        jobs.push({
          name: readStr(job, "name") ?? "",
          conclusion: readStr(job, "conclusion") ?? "",
          url: readStr(job, "html_url") ?? "",
        });
      }
    }
    return jobs;
  }
}

/** Narrow a GitHub run JSON object into a {@link WorkflowRun}. */
function toRun(run: Record<string, JsonValue>): WorkflowRun {
  return {
    id: readNum(run, "id") ?? 0,
    status: readStr(run, "status") ?? "unknown",
    conclusion: readStr(run, "conclusion") ?? null,
    url: readStr(run, "html_url") ?? "",
  };
}

/** Injectable dependencies for {@link githubWorkflowWith} — the test seams. */
export interface GithubWorkflowDeps {
  /** A transport to use directly, bypassing the REST implementation (tests). */
  api?: GhWorkflowApi;
  /** The `fetch` seam handed to the default REST transport (tests). */
  fetch?: typeof fetch;
  /** Environment reader for the token; defaults to `Deno.env.get`. */
  readEnv?: (name: string) => string | undefined;
}

/** Read an environment variable, treating missing env access as unset. */
function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/**
 * {@link githubWorkflow} with injectable dependencies — the entry point both the
 * public factory and the tests call.
 */
export function githubWorkflowWith(
  configure: (settings: GithubWorkflowSettings) => GithubWorkflowSettings,
  deps: GithubWorkflowDeps,
): WaitTrigger {
  const settings = configure(new GithubWorkflowSettings());
  const repo = settings.repo_;
  const workflow = settings.workflow_;
  if (repo === undefined || workflow === undefined) {
    throw new Error(
      "githubWorkflow(...) needs a repo and a workflow — call s.repo(...).workflow(...).",
    );
  }
  const api = deps.api ??
    new RestGhWorkflowApi({
      fetch: deps.fetch,
      token: resolveToken(deps.readEnv ?? defaultReadEnv),
    });

  return {
    descriptor: `github:${repo}:${workflow}`,
    pollIntervalMs: settings.pollIntervalMs_,
    async isSatisfied(
      _signals: ReadonlyMap<string, SignalRecord>,
      ctx: WaitContext,
    ): Promise<boolean> {
      const entry = asRecord(ctx.state.get()[STATE_KEY]);
      if (entry !== undefined && entry.done === true) return true;
      const marker = (entry && readStr(entry, "marker")) ??
        `zuke:${ctx.runId}:${ctx.target}`;
      const dispatched = entry !== undefined && entry.dispatched === true;

      // 1. Dispatch once, then suspend until a later poll.
      if (!dispatched) {
        await api.dispatch(repo, workflow, settings.ref_, {
          ...settings.inputs_,
          [settings.markerInput_]: marker,
        });
        await persist(ctx.state, { marker });
        return false;
      }

      // The run is dispatched; the rest is polling GitHub. A transient error
      // here (a 5xx, a rate-limit, a network blip, a timeout) must NOT fail the
      // build — it is treated as "not ready yet", so the wait stays suspended
      // and retries on the next `zuke resume --check`. The persisted marker/runId
      // are preserved, so no dispatch or correlation work is lost.
      try {
        // 2. Correlate the dispatched run by its marker, once it appears.
        let runId = entry === undefined ? undefined : readNum(entry, "runId");
        if (runId === undefined) {
          const run = await api.findRun(repo, workflow, marker);
          if (run === null) return false;
          runId = run.id;
          await persist(ctx.state, { marker, runId });
        }

        // 3. Poll until it completes, then record the per-job result.
        const run = await api.getRun(repo, runId);
        if (run.status !== "completed") return false;
        const jobs = await api.listJobs(repo, runId);
        const result: WorkflowResult = {
          passed: run.conclusion === "success",
          conclusion: run.conclusion ?? "unknown",
          runId,
          url: run.url,
          jobs,
        };
        await persist(ctx.state, { marker, runId, result });
        return true;
      } catch {
        // Stay suspended and poll again next check.
        return false;
      }
    },
  };
}

/**
 * A {@link "@zuke/core".WaitTrigger} that dispatches a GitHub Actions workflow,
 * suspends the run until it finishes, and records its per-job conclusions to the
 * awaiting target's state (read them with {@link readWorkflowResult}). See the
 * module docs for the `run-name` correlation requirement and auth.
 *
 * ```ts
 * githubWorkflow((g) => g.repo("acme/app").workflow("e2e.yml").ref("main"))
 * ```
 */
export function githubWorkflow(
  configure: (settings: GithubWorkflowSettings) => GithubWorkflowSettings,
): WaitTrigger {
  return githubWorkflowWith(configure, {});
}
