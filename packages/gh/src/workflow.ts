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
 * **Unmodified workflows.** A workflow that can't echo the marker (a long tail
 * of repos you don't own) correlates **best-effort** with
 * `.correlate("created-window")`: the trigger snapshots the runs that already
 * exist at dispatch and then claims the *new* `workflow_dispatch` run on the
 * dispatch ref created just after — excluding pre-existing runs and failing
 * loudly if two fresh candidates sit in the window. (The residual ceiling: a
 * foreign dispatch on the same ref that lands in the window and becomes visible
 * before ours could still be claimed in error; prefer marker correlation when
 * the workflow can echo the marker.) Either way, if no run is identified within a
 * short **discovery window** (`.discoveryTimeout(...)`, default one minute), the
 * wait fails fast with guidance — a workflow that silently never echoes the
 * marker surfaces in ~a minute instead of eating the whole `.timeout()`. The
 * discovery deadline is measured from the persisted dispatch time, so it holds
 * across a suspend/resume.
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
  /** ISO-8601 time the run was created — used by created-window correlation. */
  createdAt: string;
  /** The branch the run ran on — matched against the dispatch ref in created-window mode. */
  headBranch: string;
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
  /**
   * Recent `workflow_dispatch` runs of `workflow`, newest first — the candidate
   * pool for created-window correlation (which filters them by branch and
   * creation time). An implementation must return only `workflow_dispatch` runs.
   */
  recentRuns(repo: string, workflow: string): Promise<WorkflowRun[]>;
  /** The current state of run `runId`. */
  getRun(repo: string, runId: number): Promise<WorkflowRun>;
  /** The jobs of run `runId`. */
  listJobs(repo: string, runId: number): Promise<WorkflowJob[]>;
}

/**
 * How {@link githubWorkflow} correlates the run it dispatched:
 * - `"marker"` — match the `zuke:<runId>:<target>` marker echoed into the run's
 *   `run-name:` (exact, but the target workflow must opt in).
 * - `"created-window"` — claim the `workflow_dispatch` run on the dispatch ref
 *   created just after dispatch; **best-effort**, for workflows that can't echo
 *   the marker (fails loudly if two candidates are in the window).
 */
export type CorrelateMode = "marker" | "created-window";

/**
 * A {@link githubWorkflow} correlation failure the wait must **not** swallow as a
 * transient blip: the dispatched run could not be identified (it never echoed the
 * marker within the discovery window, or created-window correlation found more
 * than one candidate). Thrown from the trigger so the waiting target fails with
 * guidance instead of eating the whole `.timeout()`.
 */
export class WorkflowCorrelationError extends Error {
  /** The error name, `"WorkflowCorrelationError"`. */
  override name = "WorkflowCorrelationError";
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
  /** How the dispatched run is correlated (default `"marker"`); set by {@link correlate}. */
  correlateMode_: CorrelateMode = "marker";
  /** How long to wait for the run to appear before failing fast (ms); set by {@link discoveryTimeout}. */
  discoveryTimeoutMs_?: number;
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

  /**
   * How the dispatched run is correlated: `"marker"` (default) matches the
   * marker echoed into the run's `run-name:`; `"created-window"` claims the
   * `workflow_dispatch` run on the dispatch ref created just after dispatch —
   * a **best-effort** fallback for a workflow that cannot echo the marker.
   */
  correlate(mode: CorrelateMode): this {
    this.correlateMode_ = mode;
    return this;
  }

  /**
   * How long after dispatch to keep looking for the run before failing fast with
   * guidance (a duration string; default one minute). Bounds the "workflow never
   * echoed the marker" failure so it surfaces in ~a minute instead of eating the
   * whole `.timeout()`.
   */
  discoveryTimeout(duration: string): this {
    this.discoveryTimeoutMs_ = parseDuration(duration);
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

/** Read a numeric array field of a JSON object, or `[]` when absent/malformed. */
function readNumArray(
  object: Record<string, JsonValue> | undefined,
  key: string,
): number[] {
  const value = object?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === "number");
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
    dispatchedAt?: number;
    baselineIds?: number[];
    runId?: number;
    result?: WorkflowResult;
  },
): Promise<void> {
  const value: Record<string, JsonValue> = {
    dispatched: true,
    marker: data.marker,
  };
  // The dispatch timestamp anchors the discovery window and the created-window
  // filter, and the baseline excludes pre-existing runs — so every write must
  // carry them forward (a persist replaces the entry).
  if (data.dispatchedAt !== undefined) value.dispatchedAt = data.dispatchedAt;
  if (data.baselineIds !== undefined) value.baselineIds = data.baselineIds;
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

/** Default discovery window: fail fast if the run has not appeared within this. */
const DEFAULT_DISCOVERY_TIMEOUT_MS = 60_000;

/**
 * Clock-skew allowance for created-window correlation: a run whose GitHub
 * `created_at` is up to this far *before* our dispatch timestamp still counts, so
 * modest skew between this host and GitHub doesn't drop the run.
 */
const CREATED_WINDOW_SKEW_MS = 30_000;

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

  /**
   * The newest page of `workflow_dispatch` runs of `workflow` (the API returns
   * them newest first). One page suffices for created-window correlation — the
   * run being sought was created seconds ago, so it is at the top.
   */
  async recentRuns(repo: string, workflow: string): Promise<WorkflowRun[]> {
    const body = await this.#get(
      `/repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=100`,
    );
    const runs = body.workflow_runs;
    if (!Array.isArray(runs)) return [];
    const out: WorkflowRun[] = [];
    for (const raw of runs) {
      const run = asRecord(raw);
      if (run !== undefined) out.push(toRun(run));
    }
    return out;
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
    createdAt: readStr(run, "created_at") ?? "",
    headBranch: readStr(run, "head_branch") ?? "",
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
  /** The clock (epoch ms) for the discovery window; defaults to `Date.now` (tests inject it). */
  now?: () => number;
}

/**
 * Pick the one `workflow_dispatch` run this dispatch produced from `runs`: same
 * branch as the dispatch `ref`, created at/after the dispatch time (minus a small
 * skew allowance), and **not** one of the `baseline` runs that already existed
 * when we dispatched (so a run someone else started just before ours is never
 * claimed). Returns the sole match, `null` when none has appeared yet, or throws
 * {@link WorkflowCorrelationError} when two or more sit in the window —
 * best-effort correlation deliberately refuses to guess between them.
 */
function correlateByWindow(
  runs: readonly WorkflowRun[],
  ref: string,
  dispatchedAtMs: number,
  workflow: string,
  baseline: readonly number[],
): WorkflowRun | null {
  const floor = dispatchedAtMs - CREATED_WINDOW_SKEW_MS;
  const candidates = runs.filter((r) => {
    if (r.headBranch !== ref || baseline.includes(r.id)) return false;
    const created = Date.parse(r.createdAt);
    return !Number.isNaN(created) && created >= floor;
  });
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    const urls = candidates.map((r) => r.url).join(", ");
    throw new WorkflowCorrelationError(
      `githubWorkflow: created-window correlation for "${workflow}" on "${ref}" ` +
        `is ambiguous — ${candidates.length} workflow_dispatch runs in the ` +
        `window (${urls}). Echo the marker into run-name: and use marker ` +
        `correlation, or dispatch on a dedicated ref.`,
    );
  }
  return candidates[0];
}

/**
 * The ids of the `workflow_dispatch` runs that already exist just before we
 * dispatch — the baseline created-window correlation excludes so it never claims
 * a pre-existing run. Best-effort: a transient error yields an empty baseline,
 * and correlation then leans on the ambiguity guard.
 */
async function snapshotBaseline(
  api: GhWorkflowApi,
  repo: string,
  workflow: string,
): Promise<number[]> {
  try {
    return (await api.recentRuns(repo, workflow)).map((r) => r.id);
  } catch {
    return [];
  }
}

/** Build the fast-fail guidance message for a run that never appeared, per mode. */
function discoveryFailure(
  mode: CorrelateMode,
  ctx: {
    workflow: string;
    ref: string;
    markerInput: string;
    discoveryTimeoutMs: number;
  },
): string {
  const secs = Math.round(ctx.discoveryTimeoutMs / 1000);
  if (mode === "created-window") {
    return `githubWorkflow: no workflow_dispatch run of "${ctx.workflow}" on ` +
      `"${ctx.ref}" appeared within ${secs}s of dispatch — can "${ctx.workflow}" ` +
      `be dispatched on that ref?`;
  }
  return `githubWorkflow: no run of "${ctx.workflow}" matched the marker within ` +
    `${secs}s of dispatch. Does "${ctx.workflow}" echo the "${ctx.markerInput}" ` +
    `input into its run-name:? (run-name: \${{ inputs.${ctx.markerInput} }}) — ` +
    `or switch to .correlate("created-window").`;
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
  const now = deps.now ?? (() => Date.now());
  const mode = settings.correlateMode_;
  const discoveryTimeoutMs = settings.discoveryTimeoutMs_ ??
    DEFAULT_DISCOVERY_TIMEOUT_MS;

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
      const baselineIds = readNumArray(entry, "baselineIds");

      // Throw the fast-fail guidance error — hoisted so both the "no run" and the
      // "API threw during discovery" paths can invoke it.
      const failDiscovery = (): never => {
        throw new WorkflowCorrelationError(discoveryFailure(mode, {
          workflow,
          ref: settings.ref_,
          markerInput: settings.markerInput_,
          discoveryTimeoutMs,
        }));
      };

      // 1. Dispatch once. In created-window mode, snapshot the runs that already
      //    exist **before** dispatching, so correlation never claims one that
      //    was already there (e.g. a nightly cron or a colleague's run on the
      //    same branch). Then stamp the dispatch time and suspend.
      if (!dispatched) {
        const baseline = mode === "created-window"
          ? await snapshotBaseline(api, repo, workflow)
          : undefined;
        await api.dispatch(repo, workflow, settings.ref_, {
          ...settings.inputs_,
          [settings.markerInput_]: marker,
        });
        await persist(ctx.state, {
          marker,
          dispatchedAt: now(),
          baselineIds: baseline,
        });
        return false;
      }

      // Anchor the discovery clock. A record predating M18 has no dispatchedAt;
      // backfill and persist it **once** so the deadline is stable across
      // resumes (recomputing it every poll would reset the window forever).
      let runId = entry === undefined ? undefined : readNum(entry, "runId");
      let dispatchedAt = entry ? readNum(entry, "dispatchedAt") : undefined;
      if (dispatchedAt === undefined) {
        dispatchedAt = now();
        await persist(ctx.state, { marker, dispatchedAt, runId, baselineIds });
      }
      const anchor = dispatchedAt;

      // The run is dispatched; the rest is polling GitHub. A transient error here
      // (a 5xx, a rate-limit, a network blip) must NOT fail the build — it is
      // "not ready yet", so the wait stays suspended and retries next check. Two
      // exceptions: a WorkflowCorrelationError is fatal (re-thrown), and while
      // the run is still uncorrelated the discovery deadline applies even to a
      // thrown error — a bad token or renamed workflow must fail fast, not eat
      // the whole `.timeout()`.
      try {
        // 2. Correlate the dispatched run, once it appears.
        if (runId === undefined) {
          const run = mode === "created-window"
            ? correlateByWindow(
              await api.recentRuns(repo, workflow),
              settings.ref_,
              anchor,
              workflow,
              baselineIds,
            )
            : await api.findRun(repo, workflow, marker);
          if (run === null) {
            if (now() - anchor > discoveryTimeoutMs) failDiscovery();
            return false;
          }
          runId = run.id;
          await persist(ctx.state, {
            marker,
            runId,
            dispatchedAt: anchor,
            baselineIds,
          });
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
        await persist(ctx.state, {
          marker,
          runId,
          result,
          dispatchedAt: anchor,
          baselineIds,
        });
        return true;
      } catch (error) {
        if (error instanceof WorkflowCorrelationError) throw error; // fatal
        // A discovery-phase error (run not yet correlated) also honours the
        // deadline, so a persistent correlation failure fails fast.
        if (runId === undefined && now() - anchor > discoveryTimeoutMs) {
          failDiscovery();
        }
        return false; // transient → stay suspended, poll again next check
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
