/**
 * The executor: resolves a plan, runs each target body in order, reports
 * pass/fail with timing, and aborts on the first failure.
 *
 * Visual rendering — colour, the ruled per-target headers, the end-of-build
 * summary table, the GitHub Actions `::group::` commands, and the Markdown
 * job-summary file — lives in `./report.ts`. The executor only decides what to
 * run and feeds the renderer; this module owns orchestration, parameter
 * resolution, caching, lifecycle hooks, and the sequential/parallel scheduler.
 *
 * Sequencing and de-duplication are handled by {@link plan} — the returned
 * order already contains each target exactly once, so diamond dependencies run
 * their shared prerequisite a single time.
 */

import type { Build, BuildResult, TargetStatus } from "./build.ts";
import { planGraph } from "./graph.ts";
import {
  discoverParameters,
  ParameterError,
  resolveParameters,
} from "./params.ts";
import {
  type BuildCache,
  CACHE_FILE,
  defaultCacheHost,
  isCacheable,
  openCache,
} from "./cache.ts";
import { findConfigDir, pathExists } from "./config.ts";
import {
  type AffectedOptions,
  affectedTargets,
  gitChangedFiles,
} from "./affected.ts";
import { type RemoteCacheStore, resolveRemoteStore } from "./remote_cache.ts";
import { isCI } from "./host.ts";
import { ServiceBuilder, ServiceRegistry } from "./service.ts";
import { Redactor } from "./redact.ts";
import { absolutePath } from "./path.ts";
import {
  ForEachSettings,
  type ForEachSpec,
  LockSettings,
  type OnTimeout,
  type Remediation,
  type TargetBuilder,
  type TargetContext,
  WaitSettings,
} from "./target.ts";
import type { Configure } from "./tooling.ts";
import type { WaitContext } from "./wait.ts";
import type {
  RunRecord,
  SignalRecord,
  WaitDisposition,
  WaitState,
} from "./state/types.ts";
import { withAmbientSignal } from "./ambient_signal.ts";
import { defaultStateHost, type StateStore } from "./state/store.ts";
import { resolveStateStore } from "./state/resolve.ts";
import { buildRunRecord, ciRunUrl, resolveActor } from "./state/record.ts";
import { inMemoryStateHandle, RunStateWriter } from "./state/writer.ts";
import { cancelEvent, runCompensations } from "./cancel.ts";
import { LockConflictError, type LockHolder } from "./state/lock.ts";
import { parseDuration } from "./duration.ts";
import type { Plugin, RunInfo, TargetTiming } from "./plugin.ts";
import {
  detectWidth,
  type Style,
  type TargetReport,
  targetWaitFooter,
} from "./report.ts";
import { defaultRenderer, type Renderer } from "./renderer.ts";

/** The artifact directory (under the repo root) for the cache store. */
const ARTIFACT_DIR = ".zuke";

/** Sink for executor output, defaulting to the console. Overridable in tests. */
export interface Reporter {
  /** Write an informational line. */
  info(line: string): void;
  /** Write an error line. */
  error(line: string): void;
}

const consoleReporter: Reporter = {
  info: (line) => console.log(line),
  error: (line) => console.error(line),
};

const silentReporter: Reporter = { info: () => {}, error: () => {} };

/** Wrap a reporter so every line is passed through the {@link Redactor} first. */
function redactingReporter(inner: Reporter, redactor: Redactor): Reporter {
  return {
    info: (line) => inner.info(redactor.redact(line)),
    error: (line) => inner.error(redactor.redact(line)),
  };
}

/** Options for {@link execute}. */
export interface ExecuteOptions {
  /** Suppress all banner/summary output (used by tests). */
  silent?: boolean;
  /** Custom reporter; overrides `silent`. */
  reporter?: Reporter;
  /**
   * Lifecycle observers invoked alongside the build's own hooks, in order.
   * Lets third-party packages report/time/notify without subclassing the build.
   */
  plugins?: Plugin[];
  /** Target names to skip even if they appear in the plan (CLI `--skip`). */
  skip?: string[];
  /**
   * Run independent targets concurrently. `false`/omitted runs sequentially in
   * deterministic order; `true` uses the host's CPU count; a number sets the
   * maximum concurrency. Dependencies still complete before their dependents.
   */
  parallel?: boolean | number;
  /**
   * Incremental caching: skip targets whose declared {@link TargetBuilder.inputs}
   * are unchanged since the last successful run (and whose outputs still exist).
   * Defaults to on; pass `false` to disable (CLI `--no-cache`). A {@link
   * BuildCache} may be supplied directly (used in tests).
   */
  cache?: boolean | BuildCache;
  /**
   * A {@link RemoteCacheStore} that shares target {@link TargetBuilder.outputs}
   * across machines: a local cache miss restores outputs from it, and a
   * successful run uploads them. `false` disables it (CLI `--no-remote-cache`).
   * When omitted, the build's `remoteCache()` override is used, falling back to
   * the `ZUKE_REMOTE_CACHE_*` environment variables. Ignored when `cache` is a
   * supplied {@link BuildCache} or is `false`.
   */
  remoteCache?: RemoteCacheStore | false;
  /**
   * Raw parameter values from the command line, keyed by parameter (property)
   * name. Each declared {@link Parameter} is resolved from this map, then the
   * environment, then its declared default before any target runs.
   */
  params?: Record<string, string>;
  /**
   * Reads an environment variable as a parameter fallback. Defaults to
   * `Deno.env.get` (returning `undefined` when env access is unavailable);
   * overridable so parameter resolution can be tested hermetically.
   */
  readEnv?: (name: string) => string | undefined;
  /**
   * Prompt for a missing required parameter, returning the entered value (or
   * `undefined` to leave it unset). Defaults to an interactive terminal prompt
   * when stdin is a TTY and the build is not on CI; overridable for testing.
   */
  prompt?: (
    flag: string,
    description: string | undefined,
  ) => string | undefined;
  /**
   * Plan only: resolve and print every target that *would* run (honouring
   * `--skip` and `onlyWhen` conditions) without executing any body or touching
   * the cache (CLI `--dry-run`).
   */
  dryRun?: boolean;
  /**
   * Restrict the run to the targets affected by files changed since a base git
   * revision (CLI `--affected[=<base>]`). A target is affected when a changed
   * file falls inside its declared {@link TargetBuilder.inputs} or a dependency
   * is affected; a target that declares no inputs is always considered affected.
   * Unaffected targets are skipped. The base revision defaults to `HEAD`; supply
   * `changedFiles` to inject the diff (used in tests).
   */
  affected?: AffectedOptions;
  /**
   * Force GitHub Actions output formatting on or off. Auto-detected from the
   * `GITHUB_ACTIONS` environment variable when omitted.
   */
  github?: boolean;
  /**
   * Force ANSI colour on or off. Auto-detected (a TTY with `NO_COLOR` unset,
   * outside GitHub Actions) when omitted; off by default with a custom reporter.
   */
  color?: boolean;
  /**
   * Renderer for the per-target banners and the end-of-build summary. Defaults
   * to Zuke's built-in {@link defaultRenderer}; `@zuke/console` exports an
   * alternative a build can inject to restyle its output.
   */
  renderer?: Renderer;
  /**
   * Cancel the run when this signal aborts (wired to Ctrl-C/SIGTERM by the CLI,
   * or fired by another process running `zuke cancel`). Every target body's
   * {@link "./target.ts".TargetContext} `signal` mirrors it, and it is applied
   * as the shell's ambient default so an in-flight `$` command is terminated
   * (SIGTERM) on cancellation. When the run is cancelled, the compensations of
   * every target that had **succeeded** run in reverse order (see
   * {@link "./target.ts".TargetBuilder.onCancel}) and the result is a non-ok
   * `cancelled` outcome. A body that ignores its signal still runs to
   * completion, so promptly-cancellable work should pass `ctx.signal` to its
   * shell commands.
   */
  signal?: AbortSignal;
  /**
   * Durable run state (see {@link "./state/store.ts".StateStore}). A supplied
   * store is used directly; `false` disables state entirely. When omitted, the
   * build's `stateStore()` override is used, falling back to `ZUKE_STATE_URL` /
   * `ZUKE_STATE_DIR`, and finally — only when {@link state} is set — a
   * filesystem store under `<root>/.zuke/runs`.
   */
  stateStore?: StateStore | false;
  /**
   * Opt a plain build into durable state (CLI `--state`): fall back to a
   * `.zuke/runs` filesystem store when nothing else is configured. Ignored when
   * a store is resolved from {@link stateStore}, the build, or the environment.
   */
  state?: boolean;
  /**
   * Who to attribute the run to in its state record (CLI `--actor`). Falls back
   * to `ZUKE_ACTOR`, then the CI actor, then `"anonymous"`.
   */
  actor?: string;
  /**
   * Continue a suspended run instead of starting a fresh one. Set by
   * {@link "./resume.ts".resumeRun} after it has transitioned the run to
   * `running`; carries the existing record, its store version, and the targets
   * already succeeded (which are not re-run). Not for direct use — call
   * `resumeRun`.
   */
  resume?: ResumeState;
}

/** The continuation state {@link resumeRun} hands to {@link execute} on a resume. */
export interface ResumeState {
  /** The run being continued (already transitioned to `running`). */
  record: RunRecord;
  /** Its current store version, for the writer to continue from. */
  version: string;
  /** Names of targets recorded `succeeded` — seeded as done, never re-run. */
  done: ReadonlySet<string>;
}

/** Whether the build is running inside a GitHub Actions runner. */
function inGitHubActions(): boolean {
  try {
    return Deno.env.get("GITHUB_ACTIONS") === "true";
  } catch {
    return false;
  }
}

/** Read an environment variable, treating missing env access as unset. */
function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** Prompt for a missing required parameter, only at an interactive (non-CI) TTY. */
function defaultPrompt(
  flag: string,
  description: string | undefined,
): string | undefined {
  let interactive = false;
  try {
    interactive = Deno.stdin.isTerminal();
  } catch {
    interactive = false;
  }
  if (!interactive || isCI()) return undefined;
  const label = description ? `--${flag} (${description})` : `--${flag}`;
  return prompt(`${label}:`) ?? undefined;
}

/**
 * Evaluate up-front conditions for `whenSkipped("skip-dependencies")` targets;
 * return the names to skip — those targets plus any dependencies that no other
 * target in the plan needs.
 */
async function conditionSkips(
  root: TargetBuilder,
  order: TargetBuilder[],
): Promise<Set<string>> {
  const pruned = new Set<TargetBuilder>();
  for (const t of order) {
    if (!t.skipDependencies_ || t.onlyWhen_.length === 0) continue;
    let run = true;
    for (const condition of t.onlyWhen_) {
      if (!(await condition())) {
        run = false;
        break;
      }
    }
    if (!run) pruned.add(t);
  }
  if (pruned.size === 0) return new Set();

  // Everything still reachable from the root without pulling dependencies in
  // *through* a pruned target.
  const kept = new Set<TargetBuilder>();
  const walk = (node: TargetBuilder) => {
    if (node === undefined || kept.has(node)) return;
    kept.add(node);
    if (pruned.has(node)) return;
    for (const dep of node.dependsOn_) walk(dep);
    for (const trigger of node.triggers_) walk(trigger);
  };
  walk(root);

  const names = new Set<string>();
  for (const t of pruned) names.add(t.name_ ?? "");
  for (const t of order) if (!kept.has(t)) names.add(t.name_ ?? "");
  return names;
}

/** Whether terminal colour should be used (TTY, and `NO_COLOR` unset). */
function autoColor(): boolean {
  try {
    if (Deno.env.get("NO_COLOR")) return false;
  } catch {
    return false;
  }
  return Deno.stdout.isTerminal();
}

/** Resolve the output style from the options and the detected environment. */
function resolveStyle(options: ExecuteOptions, github: boolean): Style {
  const color = options.color ??
    (github || options.reporter !== undefined ? false : autoColor());
  return { github, color, width: detectWidth() };
}

/**
 * Open a target's section — a collapsible group under GitHub Actions, or a
 * ruled header in a terminal, separated from the previous block by a blank
 * line.
 */
function openTarget(
  r: Reporter,
  renderer: Renderer,
  style: Style,
  name: string,
  opened: number,
): void {
  if (!style.github && opened > 0) r.info("");
  for (const line of renderer.targetHeader(style, name)) r.info(line);
}

/** Close a target's section after it succeeded. */
function passTarget(
  r: Reporter,
  renderer: Renderer,
  style: Style,
  name: string,
  ms: number,
): void {
  for (const line of renderer.targetPassFooter(style, name, ms)) r.info(line);
}

/** Close a target's section after it failed and surface the error. */
function failTarget(
  r: Reporter,
  renderer: Renderer,
  style: Style,
  name: string,
  ms: number,
  error: unknown,
): void {
  const { info, error: err } = renderer.targetFailFooter(
    style,
    name,
    ms,
    error,
  );
  for (const line of info) r.info(line);
  for (const line of err) r.error(line);
}

/** Append the Markdown job-summary table to `GITHUB_STEP_SUMMARY`, if set. */
function writeJobSummary(
  renderer: Renderer,
  reports: TargetReport[],
  totalMs: number,
  ok: boolean,
): void {
  let path: string | undefined;
  try {
    path = Deno.env.get("GITHUB_STEP_SUMMARY");
  } catch {
    return;
  }
  if (path === undefined || path === "") return;
  try {
    // Append, not overwrite: validations like the AI reviewers/fixer write their
    // own sections to this same file during the run, and overwriting here would
    // wipe them. GitHub provisions a fresh summary file per step, so a single
    // run's appends never accumulate across steps.
    Deno.writeTextFileSync(
      path,
      renderer.jobSummaryMarkdown(reports, totalMs, ok),
      { append: true },
    );
  } catch {
    // Best-effort: an unwritable summary file must never fail the build.
  }
}

/** The result of one target, plus the framework error if it failed. */
interface TargetOutcome {
  status: TargetStatus;
  ms: number;
  error?: unknown;
  /**
   * For a `.forEach(...)` fan-out target, the reports of its materialised
   * sub-targets, surfaced into the build summary and run record beneath the
   * parent row. Undefined for an ordinary target.
   */
  children?: TargetReport[];
}

/** What a run (sequential or parallel) produced, fed into the shared summary. */
interface RunOutcome {
  reports: TargetReport[];
  executed: string[];
  failure: unknown;
  aborted: boolean;
  /** True when the run parked at a `.waitsFor(...)` gate rather than finishing. */
  suspended: boolean;
}

/**
 * Per-run values threaded to the schedulers and each target: the run id, the
 * cancellation signal handed to every {@link TargetContext}, and the optional
 * durable-state writer that records transitions.
 */
interface RunEnv {
  runId: string;
  signal: AbortSignal;
  writer?: RunStateWriter;
  /** The resolved state store, if any — needed to acquire cross-run locks. */
  store?: StateStore;
  /** The run's actor, stamped on a lock holder. */
  actor: string;
  /** A link to this run (CI job), stamped on a lock holder when known. */
  runUrl?: string;
  /** External signals received so far, exposed to bodies via `ctx.signals`. */
  signals: ReadonlyMap<string, SignalRecord>;
  /** On a resume, target names already succeeded — seeded done, never re-run. */
  done?: ReadonlySet<string>;
}

/** A failure's message, or `undefined` when there was none — for the state record. */
function errorMessage(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  return error instanceof Error ? error.message : String(error);
}

/** A held cross-run lock: `release` clears its heartbeat and frees it. */
interface HeldLock {
  release(): Promise<void>;
}

/** The default conflict guidance when a target declares no `onConflict`. */
function defaultConflictGuidance(key: string, holder: LockHolder): string {
  const url = holder.runUrl === undefined ? "" : ` — ${holder.runUrl}`;
  return `Lock "${key}" is held by ${holder.actor} (run ${holder.runId}) ` +
    `since ${holder.since}${url}. Wait for that run to finish, or stop it, ` +
    `then retry.`;
}

/**
 * Acquire a target's cross-run lock, if it declares one. Returns `null` when it
 * declares no lock, or a {@link HeldLock} once acquired. Throws a
 * {@link LockConflictError} when another run holds it, or a friendly error when
 * a lock is declared but no store is configured.
 */
async function acquireTargetLock(
  t: TargetBuilder,
  env: RunEnv,
): Promise<HeldLock | null> {
  const configure = t.lock_;
  if (configure === undefined) return null;
  // Run the settings lambda now — after parameters have resolved — so a key
  // built from `this.<param>.value` sees the final value.
  const settings = configure(new LockSettings());
  const name = t.name_ ?? "?";
  const key = settings.key_;
  if (key === undefined) {
    throw new Error(
      `Target "${name}" .lock(...) set no key — call s.lockKey(...) or s.key(...).`,
    );
  }
  const store = env.store;
  if (store === undefined) {
    throw new Error(
      `Target "${name}" declares .lock("${key}") but no state store is ` +
        `configured — a lock needs one. Pass --state, set ZUKE_STATE_DIR / ` +
        `ZUKE_STATE_URL, or override stateStore().`,
    );
  }
  if (settings.ttl_ === undefined) {
    throw new Error(
      `Target "${name}" .lock("${key}") set no TTL — call s.withTtl(...).`,
    );
  }
  const ttlMs = parseDuration(settings.ttl_);
  const holder: LockHolder = {
    actor: env.actor,
    runId: env.runId,
    since: new Date().toISOString(),
  };
  if (env.runUrl !== undefined) holder.runUrl = env.runUrl;

  const result = await store.acquireLock(key, holder, ttlMs);
  if (!result.ok) {
    const guidance = settings.onConflict_
      ? settings.onConflict_(result.holder)
      : defaultConflictGuidance(key, result.holder);
    throw new LockConflictError(result.holder, guidance);
  }

  const token = result.token;
  // Renew at half the TTL so a long body keeps its short-TTL lock; cleared on
  // release. The interval is unref'd so it never keeps the process alive.
  const heartbeat = setInterval(() => {
    void store.renewLock(key, token, ttlMs);
  }, Math.max(1000, Math.floor(ttlMs / 2)));
  Deno.unrefTimer(heartbeat);
  return {
    release: async () => {
      clearInterval(heartbeat);
      await store.releaseLock(key, token);
    },
  };
}

/** Resolve a timeout thunk to a JSON-serialisable disposition (default `"fail"`). */
function resolveDisposition(thunk: OnTimeout | undefined): WaitDisposition {
  if (thunk === undefined) return "fail";
  const disposition = thunk();
  if (disposition === "fail" || disposition === "cancel-run") {
    return disposition;
  }
  return { target: disposition.name_ ?? "?" };
}

/** The outcome of evaluating a target's `.waitsFor(...)` gate. */
interface WaitResolution {
  satisfied: boolean;
  waitState: WaitState;
  descriptor: string;
}

/**
 * Run a target's wait settings lambda, evaluate its trigger against the run's
 * signals, and build the {@link WaitState} to record if it must suspend.
 */
async function resolveWait(
  configure: Configure<WaitSettings>,
  env: RunEnv,
  name: string,
): Promise<WaitResolution> {
  const settings = configure(new WaitSettings());
  const trigger = settings.trigger_;
  if (trigger === undefined) {
    throw new Error(
      `Target "${name}" .waitsFor(...) set no trigger — call s.on(...).`,
    );
  }
  // The trigger gets the target's durable state handle, so a stateful trigger
  // (e.g. dispatch-then-poll) can persist correlation state across the
  // suspend/resume boundary and hand a result to the body.
  const waitCtx: WaitContext = {
    state: env.writer ? env.writer.stateHandle(name) : inMemoryStateHandle(),
    runId: env.runId,
    target: name,
  };
  const satisfied = await trigger.isSatisfied(env.signals, waitCtx);
  const waitState: WaitState = {
    trigger: trigger.descriptor,
    onTimeout: resolveDisposition(settings.onTimeout_),
  };
  if (settings.timeout_ !== undefined) {
    waitState.deadline = new Date(Date.now() + parseDuration(settings.timeout_))
      .toISOString();
  }
  return { satisfied, waitState, descriptor: trigger.descriptor };
}

/**
 * The merged lifecycle: the build's own hooks plus any registered plugins,
 * invoked in order (build first, then each plugin). The run functions call
 * through this so they need not know about plugins.
 */
interface Lifecycle {
  start(): Promise<void>;
  targetStart(name: string): Promise<void>;
  targetEnd(
    name: string,
    status: TargetStatus,
    durationMs: number,
  ): Promise<void>;
  finish(result: BuildResult): Promise<void>;
  /** Notify plugins of a run-level durable status change (no-op without a store). */
  runStateChange(record: RunRecord): Promise<void>;
}

/**
 * Compose a build and its plugins into one {@link Lifecycle}. The run's
 * {@link RunInfo} is bound in, so it enriches every plugin hook without threading
 * it through each call site; the build's own hooks keep their original
 * signatures. Plugin hooks that ignore the extra arguments stay compatible.
 *
 * A plugin is an **observer** — its contract is to report, time, or notify, not
 * to change a target's result — so a throwing plugin hook is caught and reported
 * through `warn`, never allowed to break the run. The build's own hooks are the
 * build's logic and still propagate.
 */
function makeLifecycle(
  build: Build,
  plugins: Plugin[],
  run: RunInfo,
  warn: (message: string) => void,
): Lifecycle {
  const observe = async (
    hook: string,
    call: (p: Plugin) => void | Promise<void>,
  ): Promise<void> => {
    for (const p of plugins) {
      try {
        await call(p);
      } catch (error) {
        warn(
          `plugin "${p.name ?? "?"}" threw in ${hook}: ${
            errorMessage(error) ?? "unknown error"
          } (ignored — plugins observe, they do not change the run)`,
        );
      }
    }
  };
  return {
    async start() {
      await build.onStart();
      await observe("onStart", (p) => p.onStart?.(run));
    },
    async targetStart(name) {
      await build.onTargetStart(name);
      await observe("onTargetStart", (p) => p.onTargetStart?.(name, run));
    },
    async targetEnd(name, status, durationMs) {
      await build.onTargetEnd(name, status);
      const timing: TargetTiming = { runId: run.runId, durationMs };
      await observe(
        "onTargetEnd",
        (p) => p.onTargetEnd?.(name, status, timing),
      );
    },
    async finish(result) {
      await build.onFinish(result);
      await observe("onFinish", (p) => p.onFinish?.(result, run));
    },
    async runStateChange(record) {
      await observe("onRunStateChange", (p) => p.onRunStateChange?.(record));
    },
  };
}

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a target body once, rejecting with a timeout error if it runs longer than
 * `timeoutMs`. A timed-out body cannot be cancelled (JavaScript has no such
 * primitive), so it keeps running in the background — but its result is ignored.
 */
function runWithTimeout(
  fn: () => void | Promise<void>,
  timeoutMs: number | undefined,
): Promise<void> {
  const result = Promise.resolve().then(fn);
  if (timeoutMs === undefined) return result;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    result.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Run a target body, applying its {@link TargetBuilder.timeout} and
 * {@link TargetBuilder.retry} settings: each attempt is bounded by the timeout,
 * and a failure is retried (after an optional delay) up to the retry count
 * before the last error propagates.
 */
async function runBody(t: TargetBuilder, ctx: TargetContext): Promise<void> {
  const fn = t.fn_;
  if (fn === undefined) return; // guarded by the caller
  const attempts = t.retries_ + 1;
  for (let attempt = 1;; attempt++) {
    try {
      await runWithTimeout(() => fn(ctx), t.timeout_);
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      if (t.retryDelay_ > 0) await delay(t.retryDelay_);
    }
  }
}

/**
 * Run the target body, and if it fails, hand the failure to each configured
 * {@link TargetBuilder.recoverWith} remediation in turn. When any remediation
 * asks to retry, the body is re-run; this repeats up to
 * {@link TargetBuilder.recoverAttempts} times. The body finally passing resolves
 * normally; otherwise the last failure propagates. A remediation that throws is
 * treated as "could not heal" — it never masks the original build failure.
 */
async function runBodyWithRecovery(
  t: TargetBuilder,
  name: string,
  globalRecovery: Remediation[],
  ctx: TargetContext,
): Promise<void> {
  try {
    await runBody(t, ctx);
    return;
  } catch (error) {
    // A target's own remediations run first, then any build-level ones.
    const remediations = [...t.recoverWith_, ...globalRecovery];
    if (remediations.length === 0) throw error;
    let lastError = error;
    for (let attempt = 1; attempt <= t.recoverAttempts_; attempt++) {
      let willRetry = false;
      for (const r of remediations) {
        try {
          const result = await r.remediate({
            target: name,
            attempt,
            error: lastError,
          });
          if (result.retry) willRetry = true;
        } catch {
          // A throwing remediation counts as "could not heal"; keep the build
          // error intact rather than surfacing the remediation's own failure.
        }
      }
      if (!willRetry) break;
      try {
        await runBody(t, ctx);
        return;
      } catch (retryError) {
        lastError = retryError;
      }
    }
    throw lastError;
  }
}

/**
 * Run one target: honour its `onlyWhen` conditions and the incremental cache,
 * then (if it must run) open its section, run its body, and report pass/fail.
 * A condition that fails yields `skipped`; an up-to-date target yields `cached`
 * — both unblock dependents without executing the body. With `dryRun`, a target
 * that would run is reported without executing its body or touching the cache.
 */
async function runTarget(
  life: Lifecycle,
  reporter: Reporter,
  renderer: Renderer,
  style: Style,
  t: TargetBuilder,
  opened: number,
  cache: BuildCache | undefined,
  dryRun: boolean,
  globalRecovery: Remediation[],
  services: ServiceRegistry,
  env: RunEnv,
): Promise<TargetOutcome> {
  const name = t.name_ ?? "<unnamed>";

  for (const condition of t.onlyWhen_) {
    if (!(await condition())) return { status: "skipped", ms: 0 };
  }

  const missing = t.requires_.filter((p) => !p.isSet_());
  if (missing.length > 0) {
    const names = missing.map((p) => `"${p.name_ ?? "(unnamed)"}"`).join(", ");
    const error = new Error(
      `Target "${name}" requires parameter(s) that are not set: ${names}.`,
    );
    openTarget(reporter, renderer, style, name, opened);
    failTarget(reporter, renderer, style, name, 0, error);
    return { status: "failed", ms: 0, error };
  }

  if (dryRun) {
    openTarget(reporter, renderer, style, name, opened);
    for (const line of renderer.targetDryRunFooter(style, name)) {
      reporter.info(line);
    }
    return { status: "passed", ms: 0 };
  }

  // A service starts a long-lived process and stays up while its dependents
  // run; the registry stops it during teardown. It has no cacheable body and no
  // `.executes` — so it is handled before the cache and body paths below.
  if (t instanceof ServiceBuilder) {
    openTarget(reporter, renderer, style, name, opened);
    await life.targetStart(name);
    void env.writer?.markTargetRunning(name);
    const start = performance.now();
    try {
      services.register(await t.launch_(name));
      const ms = performance.now() - start;
      passTarget(reporter, renderer, style, name, ms);
      return { status: "passed", ms };
    } catch (error) {
      const ms = performance.now() - start;
      failTarget(reporter, renderer, style, name, ms, error);
      return { status: "failed", ms, error };
    }
  }

  // A `.forEach(...)` target fans out into a per-item pipeline of sub-targets,
  // driven by a nested scheduler. It has no body of its own, so it is handled
  // before the cache and body paths (like a service).
  if (t.forEach_ !== undefined) {
    return await runForEachTarget(
      t,
      t.forEach_,
      life,
      reporter,
      renderer,
      style,
      opened,
      cache,
      dryRun,
      globalRecovery,
      services,
      env,
    );
  }

  if (cache !== undefined && await cache.upToDate(t)) {
    return { status: "cached", ms: 0 };
  }

  // A `.waitsFor(...)` target is a gate, not a body: if its trigger is already
  // satisfied it passes (dependents run); otherwise the run suspends here.
  if (t.waitsFor_ !== undefined) {
    openTarget(reporter, renderer, style, name, opened);
    let wait: WaitResolution;
    try {
      wait = await resolveWait(t.waitsFor_, env, name);
    } catch (error) {
      failTarget(reporter, renderer, style, name, 0, error);
      return { status: "failed", ms: 0, error };
    }
    if (wait.satisfied) {
      passTarget(reporter, renderer, style, name, 0);
      return { status: "passed", ms: 0 };
    }
    void env.writer?.markTargetWaiting(name, wait.waitState);
    for (const line of targetWaitFooter(style, name, wait.descriptor)) {
      reporter.info(line);
    }
    return { status: "waiting", ms: 0 };
  }

  openTarget(reporter, renderer, style, name, opened);
  await life.targetStart(name);
  void env.writer?.markTargetRunning(name);
  const start = performance.now();

  if (!t.fn_) {
    const error = new Error(
      `Target "${name}" has no body — call .executes(...) before running.`,
    );
    failTarget(reporter, renderer, style, name, 0, error);
    return { status: "failed", ms: 0, error };
  }

  // One own-state handle, reused for `stateOf(this target)` so the documented
  // `stateOf(self) === state` invariant holds even store-less (a fresh
  // inMemoryStateHandle per call would drop writes).
  const ownState = env.writer
    ? env.writer.stateHandle(name)
    : inMemoryStateHandle();
  const ctx: TargetContext = {
    runId: env.runId,
    target: name,
    signal: env.signal,
    state: ownState,
    stateOf: (t) =>
      t === name
        ? ownState
        : (env.writer ? env.writer.stateHandle(t) : inMemoryStateHandle()),
    signals: env.signals,
    dryRun,
  };

  // Acquire the target's cross-run lock (if any) before the body. A conflict —
  // or a lock declared with no store — fails the target with the guidance.
  let lock: HeldLock | null;
  try {
    lock = await acquireTargetLock(t, env);
  } catch (error) {
    const ms = performance.now() - start;
    failTarget(reporter, renderer, style, name, ms, error);
    return { status: "failed", ms, error };
  }

  try {
    for (const v of t.validateBefore_) await v.validate({ target: name });
    await runBodyWithRecovery(t, name, globalRecovery, ctx);
    for (const v of t.validateAfter_) await v.validate({ target: name });
    const ms = performance.now() - start;
    if (cache !== undefined) await cache.record(t);
    passTarget(reporter, renderer, style, name, ms);
    return { status: "passed", ms };
  } catch (error) {
    const ms = performance.now() - start;
    failTarget(reporter, renderer, style, name, ms, error);
    return { status: "failed", ms, error };
  } finally {
    // Release on every path — success, failure, cancellation. The TTL is only
    // the backstop for a killed process.
    if (lock !== null) await lock.release();
  }
}

/**
 * Run a `.forEach(...)` fan-out target: materialise a pipeline of sub-targets
 * per item (named `parent[key].stage`, each stage depending on the previous),
 * then drive them all with the shared {@link runScheduled} machinery — items
 * concurrent up to the configured limit, each item's stages sequential. With
 * `continueOnItemFailure`, sub-targets are lenient so a failed item does not
 * halt its siblings; the fan-out target still fails if any item did. The
 * sub-targets' reports come back as {@link TargetOutcome.children} for the
 * summary, and each is recorded in the run's state under its own name.
 */
async function runForEachTarget(
  t: TargetBuilder,
  spec: ForEachSpec,
  life: Lifecycle,
  reporter: Reporter,
  renderer: Renderer,
  style: Style,
  opened: number,
  cache: BuildCache | undefined,
  dryRun: boolean,
  globalRecovery: Remediation[],
  services: ServiceRegistry,
  env: RunEnv,
): Promise<TargetOutcome> {
  const name = t.name_ ?? "<unnamed>";
  const settings = spec.configure
    ? spec.configure(new ForEachSettings())
    : new ForEachSettings();
  const items = spec.materialize();

  // Materialise each item's stages into named, chained sub-targets.
  const order: TargetBuilder[] = [];
  const predecessors = new Map<TargetBuilder, TargetBuilder[]>();
  for (const { key, stages } of items) {
    let prev: TargetBuilder | undefined;
    for (const [stage, sub] of Object.entries(stages)) {
      sub.name_ = `${name}[${key}].${stage}`;
      // Isolating item failures means a failed stage stays lenient: its
      // siblings keep running, only this item's later stages are blocked.
      if (settings.continueOnItemFailure_) sub.proceedAfterFailure_ = true;
      const deps = prev === undefined ? [] : [prev];
      if (prev !== undefined) sub.dependsOn_.push(prev);
      order.push(sub);
      predecessors.set(sub, deps);
      prev = sub;
    }
  }

  openTarget(reporter, renderer, style, name, opened);
  await life.targetStart(name);
  void env.writer?.markTargetRunning(name);
  reporter.info(
    items.length === 0
      ? `${name}: fan-out over 0 items — nothing to run.`
      : `${name}: fan-out over ${items.length} item(s).`,
  );
  const start = performance.now();
  const run = await runScheduled(
    life,
    order,
    predecessors,
    reporter,
    renderer,
    style,
    new Set(),
    settings.concurrency_ ?? cpuCount(),
    () => true, // items and stages overlap; predecessors enforce per-item order
    cache,
    dryRun,
    globalRecovery,
    services,
    env,
  );
  const ms = performance.now() - start;
  if (run.aborted) {
    const failed = run.reports.filter((r) => r.status === "failed").length;
    const error = run.failure ??
      new Error(`${name}: ${failed} sub-target(s) failed.`);
    failTarget(reporter, renderer, style, name, ms, error);
    return { status: "failed", ms, error, children: run.reports };
  }
  passTarget(reporter, renderer, style, name, ms);
  return { status: "passed", ms, children: run.reports };
}

/** Resolve the concurrency limit; 1 means sequential. */
function resolveConcurrency(option: boolean | number | undefined): number {
  if (option === undefined || option === false) return 1;
  if (option === true) return cpuCount();
  return option > 1 ? Math.floor(option) : 1;
}

/** The host's CPU count, used as the default parallel/batch concurrency. */
function cpuCount(): number {
  const cpus = navigator.hardwareConcurrency;
  return cpus > 0 ? cpus : 4;
}

/** A reporter that buffers lines so a target's block can flush atomically. */
function bufferReporter(): {
  reporter: Reporter;
  flush: (to: Reporter) => void;
} {
  const lines: Array<{ error: boolean; text: string }> = [];
  return {
    reporter: {
      info: (text) => void lines.push({ error: false, text }),
      error: (text) => void lines.push({ error: true, text }),
    },
    flush: (to) => {
      for (const line of lines) {
        if (line.error) to.error(line.text);
        else to.info(line.text);
      }
    },
  };
}

/** Sequentially run the plan, aborting (and skipping the rest) on first failure. */
async function runSequential(
  life: Lifecycle,
  order: TargetBuilder[],
  reporter: Reporter,
  renderer: Renderer,
  style: Style,
  skip: Set<string>,
  cache: BuildCache | undefined,
  dryRun: boolean,
  globalRecovery: Remediation[],
  services: ServiceRegistry,
  env: RunEnv,
): Promise<RunOutcome> {
  const reports: TargetReport[] = [];
  const executed: string[] = [];
  let failure: unknown;
  let aborted = false;
  let opened = 0;

  for (const t of order) {
    const name = t.name_ ?? "<unnamed>";
    if (skip.has(name) || aborted) {
      reports.push({ name, status: "skipped", ms: 0 });
      void env.writer?.markTargetSettled(name, "skipped");
      continue;
    }
    const outcome = await runTarget(
      life,
      reporter,
      renderer,
      style,
      t,
      opened,
      cache,
      dryRun,
      globalRecovery,
      services,
      env,
    );
    await life.targetEnd(name, outcome.status, outcome.ms);
    void env.writer?.markTargetSettled(
      name,
      outcome.status,
      errorMessage(outcome.error),
    );
    if (outcome.status === "passed" || outcome.status === "failed") opened++;
    reports.push({ name, status: outcome.status, ms: outcome.ms });
    // A fan-out target's sub-targets appear as their own rows beneath it.
    if (outcome.children !== undefined) reports.push(...outcome.children);
    if (outcome.status === "passed") executed.push(name);
    else if (outcome.status === "failed") {
      failure = outcome.error;
      aborted = true;
    }
  }
  return { reports, executed, failure, aborted, suspended: false };
}

/**
 * Run the plan with up to `limit` targets in flight, respecting dependencies.
 * `canOverlap` decides which ready targets may run at the same time: with
 * global parallelism it is always true; otherwise only members of the same
 * {@link group} overlap, keeping ungrouped targets serialized.
 *
 * Each target's framework output is buffered and flushed as a contiguous block
 * on completion, so concurrent runs don't interleave their banners. A failure
 * stops new launches; in-flight targets settle and the rest are skipped.
 */
async function runScheduled(
  life: Lifecycle,
  order: TargetBuilder[],
  predecessors: Map<TargetBuilder, TargetBuilder[]>,
  reporter: Reporter,
  renderer: Renderer,
  style: Style,
  skip: Set<string>,
  limit: number,
  canOverlap: (a: TargetBuilder, b: TargetBuilder) => boolean,
  cache: BuildCache | undefined,
  dryRun: boolean,
  globalRecovery: Remediation[],
  services: ServiceRegistry,
  env: RunEnv,
): Promise<RunOutcome> {
  const outcomes = new Map<TargetBuilder, TargetOutcome>();
  const done = new Set<TargetBuilder>(); // passed/cached/skipped → unblocks dependents
  const started = new Set<TargetBuilder>();
  const runningSet = new Set<TargetBuilder>();
  let failure: unknown;
  let anyFailed = false; // a failure occurred → the build fails
  let anyWaiting = false; // a `.waitsFor(...)` gate parked → the run suspends
  let halted = false; // a non-lenient failure → stop launching new targets
  let flushed = 0;

  // `--skip` targets, and targets already succeeded on a resumed run, count as
  // completed so their dependents can still run.
  for (const t of order) {
    const name = t.name_ ?? "<unnamed>";
    if (skip.has(name)) {
      outcomes.set(t, { status: "skipped", ms: 0 });
      done.add(t);
      started.add(t);
      void env.writer?.markTargetSettled(name, "skipped");
    } else if (env.done?.has(name)) {
      // Succeeded in the prior (suspended) run: unblock dependents, don't re-run,
      // and leave its recorded `succeeded` untouched.
      outcomes.set(t, { status: "cached", ms: 0 });
      done.add(t);
      started.add(t);
    }
  }

  const ready = (t: TargetBuilder): boolean =>
    (predecessors.get(t) ?? []).every((p) => done.has(p));
  const overlaps = (t: TargetBuilder): boolean =>
    [...runningSet].every((r) => canOverlap(t, r));

  await new Promise<void>((resolve) => {
    const pump = () => {
      for (const t of order) {
        if (runningSet.size >= limit) break;
        if (started.has(t) || !ready(t) || !overlaps(t)) continue;
        // After a fatal failure, stop launching — except `always` targets,
        // which run for cleanup even when the build is failing.
        if (halted && !t.always_) continue;
        started.add(t);
        runningSet.add(t);
        const buffer = bufferReporter();
        runTarget(
          life,
          buffer.reporter,
          renderer,
          style,
          t,
          flushed,
          cache,
          dryRun,
          globalRecovery,
          services,
          env,
        )
          .then(
            async (outcome) => {
              await life.targetEnd(
                t.name_ ?? "<unnamed>",
                outcome.status,
                outcome.ms,
              );
              // A waiting gate already recorded its `waitingFor` via
              // markTargetWaiting; settling it here would clobber that.
              if (outcome.status !== "waiting") {
                void env.writer?.markTargetSettled(
                  t.name_ ?? "<unnamed>",
                  outcome.status,
                  errorMessage(outcome.error),
                );
              }
              // An executed target (or a parked wait) prints a block worth
              // separating.
              const printed = outcome.status === "passed" ||
                outcome.status === "failed" || outcome.status === "waiting";
              if (printed) {
                if (!style.github && flushed > 0) reporter.info("");
                buffer.flush(reporter);
                flushed++;
              }
              outcomes.set(t, outcome);
              runningSet.delete(t);
              if (outcome.status === "failed") {
                anyFailed = true;
                failure ??= outcome.error;
                // A lenient failure lets independent targets keep going; its
                // own dependents stay blocked (never added to `done`).
                if (!t.proceedAfterFailure_) halted = true;
              } else if (outcome.status === "waiting") {
                // The run suspends here: this target's dependents stay blocked
                // (never `done`), but independent branches run to completion.
                anyWaiting = true;
              } else {
                done.add(t); // passed, cached, or condition-skipped
              }
              pump();
            },
          );
      }
      if (runningSet.size === 0) {
        for (const t of order) {
          if (!started.has(t)) {
            outcomes.set(t, { status: "skipped", ms: 0 });
            started.add(t);
            // When the run suspends, targets blocked behind the wait are left
            // `pending` in the record (a resume runs them) rather than skipped.
            if (!anyWaiting) {
              void env.writer?.markTargetSettled(
                t.name_ ?? "<unnamed>",
                "skipped",
              );
            }
          }
        }
        resolve();
      }
    };
    pump();
  });

  const reports: TargetReport[] = [];
  const executed: string[] = [];
  for (const t of order) {
    const name = t.name_ ?? "<unnamed>";
    const outcome = outcomes.get(t) ?? { status: "skipped", ms: 0 };
    reports.push({ name, status: outcome.status, ms: outcome.ms });
    // A fan-out target's sub-targets appear as their own rows beneath it.
    if (outcome.children !== undefined) reports.push(...outcome.children);
    if (outcome.status === "passed") executed.push(name);
  }
  return {
    reports,
    executed,
    failure,
    aborted: anyFailed,
    suspended: anyWaiting && !anyFailed,
  };
}

/**
 * Execute the requested target and its transitive dependencies.
 *
 * Runs the build's `onStart`/`onFinish` lifecycle hooks around the plan. By
 * default targets run sequentially in deterministic order; with `parallel`,
 * independent targets run concurrently while dependencies still complete first.
 * Stops launching after the first failure, marks unreached targets as skipped,
 * and returns a failing result.
 */
export async function execute(
  build: Build,
  root: TargetBuilder,
  options: ExecuteOptions = {},
): Promise<BuildResult> {
  const baseReporter = options.reporter ??
    (options.silent ? silentReporter : consoleReporter);
  // Every line Zuke prints passes through the redactor, which masks the
  // resolved value of each `secret` parameter. The redactor is populated during
  // parameter resolution below; since nothing meaningful is reported before
  // then, wrapping the reporter up-front is safe.
  const redactor = new Redactor();
  const reporter = redactingReporter(baseReporter, redactor);
  // The GitHub job summary is a real-world output side effect (it appends to a
  // shared file named by GITHUB_STEP_SUMMARY). Only write it when output goes to
  // the default console — i.e. neither silenced nor redirected to a custom
  // reporter. This keeps embedded/test runs (a build's own test suite calls
  // `execute` with `silent`/a custom reporter) from polluting the workflow
  // summary, while a normal CLI run still writes it.
  const writesToConsole = options.reporter === undefined && !options.silent;
  const github = options.github ?? inGitHubActions();
  const style = resolveStyle(options, github);
  const renderer = options.renderer ?? defaultRenderer;
  const skip = new Set(options.skip ?? []);

  // Resolve declared parameters (CLI value → environment → default) before any
  // target runs, so a target body can read `this.param.value`. A missing
  // required parameter or an invalid value fails the build before it starts.
  const params = discoverParameters(build);
  const readEnv = options.readEnv ?? defaultReadEnv;
  const paramErrors = await resolveParameters(
    params,
    options.params ?? {},
    readEnv,
    options.prompt ?? defaultPrompt,
    redactor,
  );
  // Register each secret's final parsed value too — its raw form was already
  // added during resolution, but a source that trims or a parser that
  // normalises could yield a slightly different printed string.
  for (const p of params.values()) {
    if (!p.secret_) continue;
    const value = p.stringValue_();
    if (value !== undefined && value !== "") redactor.add(value);
  }
  // Under GitHub Actions, also emit `::add-mask::` with the real value so the
  // runner masks it in its own logs. This goes through the base reporter, which
  // is not wrapped in the redactor — a masked directive would hide nothing.
  if (style.github) {
    for (const p of params.values()) {
      const value = p.secret_ ? p.stringValue_() : undefined;
      if (value !== undefined && value !== "") {
        baseReporter.info(`::add-mask::${value}`);
      }
    }
  }
  if (paramErrors.length > 0) {
    reporter.error("Invalid or missing parameters:");
    for (const message of paramErrors) reporter.error(`  ${message}`);
    return {
      ok: false,
      executed: [],
      error: new ParameterError(paramErrors.join("; ")),
    };
  }

  const { order, predecessors } = planGraph(root);
  // Evaluate up-front conditions for `whenSkipped("skip-dependencies")` targets
  // and skip them plus any dependencies that nothing else needs.
  for (const name of await conditionSkips(root, order)) skip.add(name);

  // With `--affected`, skip every planned target a change cannot reach. Skipped
  // targets still unblock their dependents (their prior outputs are assumed
  // current), so an affected target downstream of an unaffected one still runs.
  if (options.affected !== undefined) {
    const base = options.affected.base ?? "HEAD";
    const changedFiles = options.affected.changedFiles ?? gitChangedFiles;
    const affected = affectedTargets(order, await changedFiles(base));
    for (const t of order) {
      if (!affected.has(t)) skip.add(t.name_ ?? "<unnamed>");
    }
    if (affected.size === 0) {
      reporter.info(`No targets affected by changes since ${base}.`);
    }
  }

  const limit = resolveConcurrency(options.parallel);
  const globalParallel = limit > 1;
  const grouped = order.some((t) => t.group_ !== undefined);
  // `proceedAfterFailure` and `always` need the scheduler's per-target control,
  // so the simple sequential loop is only used when none of these apply.
  const scheduled = options.resume !== undefined ||
    order.some((t) =>
      t.proceedAfterFailure_ || t.always_ || t.waitsFor_ !== undefined
    );
  const dryRun = options.dryRun ?? false;
  // A dry run never reads or writes the cache (no body runs to invalidate it).
  const cache = dryRun ? undefined : await resolveCache(
    options.cache,
    order,
    build,
    options.remoteCache,
    readEnv,
    reporter,
  );
  const overallStart = performance.now();

  // One run identity per run (stable across a resume), established before the
  // lifecycle so every plugin hook can carry it.
  const runId = options.resume ? options.resume.record.id : crypto.randomUUID();
  const runInfo: RunInfo = { runId, dryRun };

  const life = makeLifecycle(
    build,
    options.plugins ?? [],
    runInfo,
    (message) => reporter.info(message),
  );
  await life.start();

  // Build-level remediations apply to every target (after each target's own),
  // resolved once before the run.
  const globalRecovery = dryRun ? [] : build.recoverWith();

  // One cancellation controller per run. The controller aborts when the caller's
  // `options.signal` does; its signal is handed to every target's context and
  // installed as the shell's ambient signal, so a cancelled run terminates
  // in-flight `$` child processes.
  const runController = new AbortController();
  const onCancel = () => runController.abort();
  if (options.signal !== undefined) {
    if (options.signal.aborted) runController.abort();
    else options.signal.addEventListener("abort", onCancel, { once: true });
  }
  // Set when a state write discovers another process moved this run to
  // `cancelling`/`cancelled` (a `zuke cancel` elsewhere). We then abort and let
  // that canceller own the compensation walk — we do not run it ourselves.
  let externallyCancelled = false;
  const onExternalCancel = () => {
    externallyCancelled = true;
    runController.abort();
  };

  // Resolve the durable state store (if any) and open a writer that records the
  // run and its per-target transitions. Never for a dry run — no body executes,
  // so there is no run to persist. State writes are best-effort: a store hiccup
  // is reported, never fatal (see RunStateWriter).
  // A build that uses a durable feature (a cross-run lock; later, waits and
  // compensations) turns the filesystem store on by default, so state "just
  // works" without --state. Plain builds still opt in explicitly.
  const usesDurableFeature = order.some((t) =>
    t.lock_ !== undefined || t.waitsFor_ !== undefined ||
    t.onCancel_ !== undefined
  );
  const stateStore = dryRun ? undefined : resolveStateStore(
    options.stateStore,
    build.stateStore(),
    {
      readEnv,
      host: defaultStateHost,
      defaultDir: absolutePath(
        findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd(),
      )(ARTIFACT_DIR, "runs").path,
      enableDefault: (options.state ?? false) || usesDurableFeature,
    },
  );
  // A wait needs somewhere to persist the suspension; without a store it could
  // never be resumed. Fail fast with guidance instead of suspending into the
  // void. (enableDefault turns the FS store on for waits, so this only triggers
  // when state was explicitly disabled.)
  if (
    !dryRun && stateStore === undefined &&
    order.some((t) => t.waitsFor_ !== undefined)
  ) {
    const error = new Error(
      "A target uses .waitsFor(...), which needs a state store to persist the " +
        "suspended run — but state is disabled. Enable it (drop stateStore: " +
        "false, pass --state, or set ZUKE_STATE_DIR / ZUKE_STATE_URL).",
    );
    reporter.error(error.message);
    return { ok: false, executed: [], error };
  }
  const actor = resolveActor(options.actor, readEnv);
  const runUrl = ciRunUrl(readEnv);
  const nowIso = () => new Date().toISOString();
  const warn = (message: string) => reporter.info(message);
  const writer = stateStore === undefined
    ? undefined
    : options.resume !== undefined
    // A resume continues the existing record (already transitioned to running).
    ? RunStateWriter.adopt(
      stateStore,
      options.resume.record,
      options.resume.version,
      nowIso,
      redactor,
      warn,
      onExternalCancel,
    )
    : await RunStateWriter.open(
      stateStore,
      buildRunRecord({
        runId,
        build: build.constructor.name,
        rootTarget: root.name_ ?? "<unnamed>",
        actor,
        now: nowIso(),
        order,
        params: params.values(),
      }),
      nowIso,
      redactor,
      warn,
      onExternalCancel,
    );
  const env: RunEnv = {
    runId,
    signal: runController.signal,
    writer,
    store: stateStore,
    actor,
    runUrl,
    signals: writer ? writer.signals() : new Map<string, SignalRecord>(),
    done: options.resume?.done,
  };

  // Announce the run's initial durable state (`running`) to plugins — a no-op
  // without a store. Terminal transitions are announced once the plan settles.
  if (writer !== undefined) await life.runStateChange(writer.snapshot());

  // Services started during the run are held here and torn down in reverse
  // order once it finishes — in a `finally`, so a failure never leaks a process.
  const services = new ServiceRegistry();
  const runPlan = (): Promise<RunOutcome> => {
    if (!globalParallel && !grouped && !scheduled) {
      return runSequential(
        life,
        order,
        reporter,
        renderer,
        style,
        skip,
        cache,
        dryRun,
        globalRecovery,
        services,
        env,
      );
    }
    // With `--parallel`, anything independent may overlap up to `limit`.
    // Otherwise only same-group members overlap (the rest stay serialized),
    // bounded by the CPU count.
    const effectiveLimit = globalParallel ? limit : cpuCount();
    const canOverlap = globalParallel
      ? () => true
      : (a: TargetBuilder, b: TargetBuilder) =>
        a.group_ !== undefined && a.group_ === b.group_;
    return runScheduled(
      life,
      order,
      predecessors,
      reporter,
      renderer,
      style,
      skip,
      effectiveLimit,
      canOverlap,
      cache,
      dryRun,
      globalRecovery,
      services,
      env,
    );
  };

  let run: RunOutcome;
  try {
    // Run the plan inside the ambient-signal scope so a plain `$` in a target
    // body is cancelled with the run; the binding unwinds on its own, even if
    // the plan throws — nothing to restore.
    run = await withAmbientSignal(runController.signal, runPlan);
  } finally {
    if (options.signal !== undefined) {
      options.signal.removeEventListener("abort", onCancel);
    }
    if (services.size > 0) {
      await services.stopAll((line) => reporter.info(line));
    }
  }
  if (cache !== undefined) await cache.save();

  // A cancellation (Ctrl-C / an aborted `options.signal`, or another process
  // running `zuke cancel`) takes precedence over an ordinary failure: the
  // aborted target failing is a symptom, not the outcome.
  const cancelled = runController.signal.aborted;
  let result: BuildResult;
  if (cancelled) {
    result = {
      ok: false,
      executed: run.executed,
      cancelled: true,
      runId,
    };
    if (externallyCancelled) {
      // Another process owns the cancellation: it runs the compensations and
      // settles the record. We stop and leave the run `cancelling`, draining any
      // pending per-target writes so none races the process exit.
      await writer?.drain();
      reporter.info(
        `Run ${runId} cancelled by another process — stopping.`,
      );
    } else if (writer !== undefined) {
      // We initiated it (Ctrl-C / options.signal): mark cancelling (which also
      // drains every pending per-target write, so the snapshot is current).
      await writer.markRunCancelling();
      // markRunCancelling drains the write chain, so if another process's
      // `zuke cancel` won the race in the meantime, the conflict has already
      // fired onExternalCancel. Re-check before walking, so we never run the
      // compensations twice (that canceller owns them now).
      if (externallyCancelled) {
        await writer.drain();
        reporter.info(
          `Run ${runId} cancelled by another process — stopping.`,
        );
      } else {
        // Announce the intermediate `cancelling` transition (the record was just
        // moved there) before compensations run, so a plugin sees the full
        // running → cancelling → cancelled sequence.
        await life.runStateChange(writer.snapshot());
        // Run the succeeded targets' compensations in reverse order, record the
        // cancellation in the audit trail (as `zuke cancel` does), then settle.
        const comp = await runCompensations(order, writer.snapshot(), {
          runId,
          signals: env.signals,
          reporter,
          redactor,
        });
        await writer.appendEvent(cancelEvent(actor, comp, nowIso()));
        await writer.markRunCancelled();
        reporter.info(
          `Run ${runId} cancelled — ${comp.compensated.length} ` +
            `compensation(s) ran${
              comp.failures.length > 0 ? `, ${comp.failures.length} failed` : ""
            }.`,
        );
      }
    }
  } else {
    result = run.aborted
      ? { ok: false, executed: run.executed, error: run.failure, runId }
      : run.suspended
      ? { ok: true, executed: run.executed, suspended: true, runId }
      : { ok: true, executed: run.executed, runId };
    // Record the run's terminal status. Awaiting this drains the writer's queue,
    // so every per-target transition has landed by the time the run returns.
    if (run.suspended) await writer?.markRunSuspended();
    else await writer?.markRunFinished(result.ok);
  }

  // Announce the run's terminal durable state (succeeded/failed/suspended/
  // cancelling) to plugins, now that the transition above has landed.
  if (writer !== undefined) await life.runStateChange(writer.snapshot());

  const totalMs = performance.now() - overallStart;
  for (
    const line of renderer.summaryBlock(style, run.reports, totalMs, result.ok)
  ) {
    reporter.info(line);
  }
  // On suspension, point the operator at the saved run so it can be resumed.
  // A cancelled run never resumes, so it skips this even if it parked a wait.
  if (run.suspended && !cancelled) {
    const waiting = run.reports.filter((r) => r.status === "waiting")
      .map((r) => r.name);
    reporter.info(
      `Run ${runId} suspended — state saved; waiting on: ${
        waiting.join(", ")
      }.`,
    );
  }
  if (style.github && writesToConsole) {
    writeJobSummary(renderer, run.reports, totalMs, result.ok);
  }
  await life.finish(result);
  return result;
}

/**
 * Resolve the incremental cache for a run: `false` disables it, a supplied
 * {@link BuildCache} is used directly, and otherwise a `.zuke/cache.json`-backed
 * cache is opened — but only when at least one target declares inputs. A remote
 * output store is wired in when one is configured (see
 * {@link resolveRemoteStore}).
 */
async function resolveCache(
  option: boolean | BuildCache | undefined,
  order: TargetBuilder[],
  build: Build,
  remoteOption: RemoteCacheStore | false | undefined,
  readEnv: (name: string) => string | undefined,
  reporter: Reporter,
): Promise<BuildCache | undefined> {
  if (option === false) return undefined;
  if (typeof option === "object") return option;
  if (!order.some(isCacheable)) return undefined;
  const root = findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd();
  const storePath = absolutePath(root)(ARTIFACT_DIR, CACHE_FILE).path;
  const remote = resolveRemoteStore(remoteOption, build.remoteCache(), readEnv);
  return await openCache(storePath, defaultCacheHost, {
    remote,
    warn: (message) => reporter.info(message),
  });
}
