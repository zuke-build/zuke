/**
 * Generate CI pipeline configuration from a single typed, provider-agnostic
 * model. Describe the pipeline once as a {@link CiPipeline} — triggers, jobs,
 * an optional matrix, and steps — then render it for GitHub Actions, GitLab CI,
 * or Azure Pipelines with {@link generateCi}.
 *
 * ```ts
 * import { generateCi } from "jsr:@zuke/core";
 *
 * const pipeline = {
 *   name: "CI",
 *   triggers: { push: ["main"], pullRequest: ["main"] },
 *   jobs: [{
 *     id: "test",
 *     matrix: { os: ["ubuntu-latest", "macos-latest"] },
 *     steps: [
 *       { uses: "denoland/setup-deno@v2" },
 *       { name: "Test", run: "deno task ci" },
 *     ],
 *   }],
 * };
 * await Deno.writeTextFile(".github/workflows/ci.yml", generateCi(pipeline, "github"));
 * ```
 *
 * The model is intentionally a portable subset. A `run` step (a shell command)
 * maps to every provider; a `uses` step (a GitHub Action) only renders for
 * GitHub and is skipped elsewhere, since GitLab and Azure check out the repo
 * automatically and have no Action equivalent. `runsOn` is interpreted per
 * provider (a runner label, a Docker image, or a `vmImage`).
 *
 * @module
 */

import { toYaml, type YamlValue } from "./yaml.ts";
import { type Build, discoverTargets, forEachField } from "./build.ts";
import type { TargetBuilder } from "./target.ts";
import {
  anyScheduleNeedsGuard,
  guardShell,
  type ScheduleEntry,
  scheduleNeedsGuard,
  utcCronsFor,
} from "./ci_schedule.ts";

/** The CI providers {@link generateCi} can target. */
export type CiProvider = "github" | "gitlab" | "azure" | "bitbucket";

/** A single step in a job. */
export interface CiStep {
  /** Human-readable step name. */
  name?: string;
  /** A shell command to run. Portable across all providers. */
  run?: string;
  /**
   * A GitHub Action reference (e.g. `actions/checkout@v4`). Rendered only for
   * GitHub; skipped for GitLab and Azure.
   */
  uses?: string;
  /** Inputs for a {@link uses} Action (GitHub only). */
  with?: Record<string, string>;
  /**
   * Environment variables for this step. Rendered as `env:` on GitHub Actions
   * and on Azure Pipelines `script` steps; ignored on GitLab (which sources
   * variables from project settings, not the job YAML).
   */
  env?: Record<string, string>;
}

/** A job: a named unit of work with steps, optionally fanned out by a matrix. */
export interface CiJob {
  /** Stable identifier, used as the job key and as a dependency target. Defaults to `"build"`. */
  id?: string;
  /** Human-readable job name. */
  name?: string;
  /**
   * The runner. Interpreted per provider: a GitHub runner label and Azure
   * `vmImage` (default `ubuntu-latest`), or a GitLab Docker image (runner
   * default when omitted). Ignored when a matrix defines `os` on GitHub.
   */
  runsOn?: string;
  /** Other jobs (by {@link id}) that must finish before this one. */
  needs?: string[];
  /** A build matrix: each key fans out over its values. */
  matrix?: Record<string, Array<string | number>>;
  /** Environment variables for the job. */
  env?: Record<string, string>;
  /**
   * A condition gating the job. A raw provider expression: GitHub `if:`, Azure
   * `condition:`. Ignored on GitLab. Use it to e.g. skip forked pull requests.
   */
  if?: string;
  /** Fail the job if it runs longer than this many minutes. */
  timeoutMinutes?: number;
  /** The steps to run, in order. Defaults to a single step that runs the build. */
  steps?: CiStep[];
}

/** When the pipeline runs. */
export interface CiTriggers {
  /**
   * Branches whose pushes trigger the pipeline. An empty array means every
   * branch (no filter); omit the field to disable the push trigger.
   */
  push?: string[];
  /**
   * Branches whose pull/merge requests trigger the pipeline. An empty array
   * means every branch (no filter); omit the field to disable the trigger.
   */
  pullRequest?: string[];
  /** Allow manual runs (workflow dispatch / web). */
  manual?: boolean;
  /**
   * Timezone-aware scheduled runs. Each entry is a 5-field cron in an optional
   * IANA timezone (`{ cron: "30 9 * * 1-5", tz: "Europe/Sofia" }`). Fully
   * supported on **GitHub** (compiled to UTC crons, with a generated guard step
   * for daylight-saving zones) and **Azure** (native `schedules:`, UTC/fixed
   * offset only); **ignored** on GitLab and Bitbucket, whose schedules are
   * configured in the provider UI, not in-file. See {@link "./ci_schedule.ts"}.
   */
  schedule?: ScheduleEntry[];
}

/** A concurrency group: at most one run per group, optionally cancelling the prior one. */
export interface CiConcurrency {
  /** The group key (often interpolated, e.g. `ci-${{ github.ref }}`). */
  group: string;
  /** Cancel an in-progress run in the same group when a new one starts. */
  cancelInProgress?: boolean;
}

/** A complete, provider-agnostic CI pipeline. */
export interface CiPipeline {
  /** The pipeline name. Defaults to `"CI"`. */
  name?: string;
  /**
   * When it runs. Defaults to push and pull request on `main`; pass an empty
   * object (`{}`) for a pipeline triggered only by external means.
   */
  triggers?: CiTriggers;
  /**
   * Workflow-level token permissions (GitHub only), e.g.
   * `{ contents: "read", "pull-requests": "write" }`. Ignored elsewhere.
   */
  permissions?: Record<string, string>;
  /** Limit concurrent runs (GitHub only). Ignored elsewhere. */
  concurrency?: CiConcurrency;
  /** The jobs to run. Defaults to a single `build` job that runs the build. */
  jobs?: CiJob[];
}

/** The default runner image used when a job does not set {@link CiJob.runsOn}. */
const DEFAULT_RUNNER = "ubuntu-latest";

/** The default pipeline name. */
const DEFAULT_NAME = "CI";

/** The default job id when one is not given. */
const DEFAULT_JOB_ID = "build";

/** The id of the generated GitHub job that guards a DST-zone schedule. */
const GUARD_JOB_ID = "zuke-schedule-guard";

/** The GitHub expression that is true when the guard job cleared this run. */
const GUARD_OUTPUT_EXPR = `needs.${GUARD_JOB_ID}.outputs.run == 'true'`;

/** Strip a `${{ … }}` wrapper from a raw GitHub expression, if present. */
function unwrapExpr(expr: string): string {
  const match = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(expr.trim());
  return match !== null ? match[1] : expr;
}

/** A job `if:` that ANDs the schedule guard onto any existing condition. */
function guardedIf(existing: string | undefined): string {
  const open = "${{ ";
  const close = " }}";
  if (existing === undefined) return `${open}${GUARD_OUTPUT_EXPR}${close}`;
  return `${open}(${unwrapExpr(existing)}) && (${GUARD_OUTPUT_EXPR})${close}`;
}

/** Default triggers: push and pull request on `main`. */
const DEFAULT_TRIGGERS: CiTriggers = { push: ["main"], pullRequest: ["main"] };

/**
 * The default step: run the build through the `./zuke` launcher, which
 * bootstraps Deno itself — so a single step needs no separate setup.
 */
const DEFAULT_STEPS: CiStep[] = [{ name: "Build", run: "./zuke" }];

/** The default jobs: a single `build` job running the default steps. */
const DEFAULT_JOBS: CiJob[] = [{ steps: DEFAULT_STEPS }];

/** The conventional output path for each provider. */
const DEFAULT_PATHS: Record<CiProvider, string> = {
  github: ".github/workflows/ci.yml",
  gitlab: ".gitlab-ci.yml",
  azure: "azure-pipelines.yml",
  bitbucket: "bitbucket-pipelines.yml",
};

/** Collect the shell commands of a job's `run` steps, in order. */
function runCommands(steps: CiStep[]): string[] {
  const commands: string[] = [];
  for (const step of steps) {
    if (step.run !== undefined) commands.push(step.run);
  }
  return commands;
}

/**
 * A GitHub trigger filter: `{ branches: [...] }` for a non-empty branch list,
 * or `{}` (no filter — every branch) for an empty one.
 */
function githubTrigger(branches: string[]): YamlValue {
  return branches.length > 0 ? { branches } : {};
}

/** Render a GitHub Actions workflow object. */
function github(pipeline: CiPipeline): YamlValue {
  const triggers = pipeline.triggers ?? DEFAULT_TRIGGERS;
  const on: Record<string, YamlValue> = {};
  if (triggers.push) on.push = githubTrigger(triggers.push);
  if (triggers.pullRequest) {
    on.pull_request = githubTrigger(triggers.pullRequest);
  }
  if (triggers.manual) on.workflow_dispatch = {};
  // A tz-aware schedule compiles to UTC cron(s); a DST zone adds a guard job.
  const scheduleCrons = [
    ...new Set((triggers.schedule ?? []).flatMap(utcCronsFor)),
  ];
  if (scheduleCrons.length > 0) {
    on.schedule = scheduleCrons.map((cron) => ({ cron }));
  }
  const guarded = triggers.schedule !== undefined &&
    anyScheduleNeedsGuard(triggers.schedule);

  const concurrency = pipeline.concurrency
    ? {
      group: pipeline.concurrency.group,
      "cancel-in-progress": pipeline.concurrency.cancelInProgress,
    }
    : undefined;

  const jobs: Record<string, YamlValue> = {};
  for (const job of pipeline.jobs ?? DEFAULT_JOBS) {
    const matrixOs = job.matrix !== undefined && "os" in job.matrix;
    const steps = (job.steps ?? DEFAULT_STEPS).map((step): YamlValue => ({
      name: step.name,
      uses: step.uses,
      with: step.with,
      run: step.run,
      env: step.env,
    }));
    jobs[job.id ?? DEFAULT_JOB_ID] = {
      name: job.name,
      "runs-on": matrixOs ? "${{ matrix.os }}" : (job.runsOn ?? DEFAULT_RUNNER),
      // A guarded schedule makes every job wait on the guard and run only when
      // the guard cleared this firing (the correct wall-clock, or a non-schedule
      // event).
      needs: guarded ? [...(job.needs ?? []), GUARD_JOB_ID] : job.needs,
      if: guarded ? guardedIf(job.if) : job.if,
      "timeout-minutes": job.timeoutMinutes,
      strategy: job.matrix ? { matrix: job.matrix } : undefined,
      env: job.env,
      steps,
    };
  }
  if (guarded) {
    if (Object.hasOwn(jobs, GUARD_JOB_ID)) {
      throw new Error(
        `cicd: a job named "${GUARD_JOB_ID}" collides with the generated ` +
          `schedule guard — rename that job (or target) for a timezone-aware ` +
          `schedule.`,
      );
    }
    jobs[GUARD_JOB_ID] = {
      "runs-on": DEFAULT_RUNNER,
      outputs: { run: "${{ steps.check.outputs.run }}" },
      steps: [{ id: "check", run: guardShell(triggers.schedule ?? []) }],
    };
  }
  return {
    name: pipeline.name ?? DEFAULT_NAME,
    on,
    permissions: pipeline.permissions,
    concurrency,
    jobs,
  };
}

/** Render a GitLab CI configuration object. */
function gitlab(pipeline: CiPipeline): YamlValue {
  const triggers = pipeline.triggers ?? DEFAULT_TRIGGERS;
  const config: Record<string, YamlValue> = {};

  const rules: YamlValue[] = [];
  for (const branch of triggers.push ?? []) {
    rules.push({ if: `$CI_COMMIT_BRANCH == "${branch}"` });
  }
  if (triggers.pullRequest) {
    rules.push({ if: `$CI_PIPELINE_SOURCE == "merge_request_event"` });
  }
  if (triggers.manual) rules.push({ if: `$CI_PIPELINE_SOURCE == "web"` });
  if (rules.length > 0) config.workflow = { rules };

  config.stages = ["build"];
  for (const job of pipeline.jobs ?? DEFAULT_JOBS) {
    config[job.id ?? DEFAULT_JOB_ID] = {
      stage: "build",
      image: job.runsOn,
      needs: job.needs,
      variables: job.env,
      timeout: job.timeoutMinutes ? `${job.timeoutMinutes} minutes` : undefined,
      parallel: job.matrix ? { matrix: [job.matrix] } : undefined,
      script: runCommands(job.steps ?? DEFAULT_STEPS),
    };
  }
  return config;
}

/** Expand a matrix into Azure's named-configuration form (cartesian product). */
function azureMatrix(
  matrix: Record<string, Array<string | number>>,
): Record<string, YamlValue> {
  let combos: Array<Record<string, string | number>> = [{}];
  for (const key of Object.keys(matrix)) {
    const expanded: Array<Record<string, string | number>> = [];
    for (const combo of combos) {
      for (const value of matrix[key]) {
        expanded.push({ ...combo, [key]: value });
      }
    }
    combos = expanded;
  }
  const configs: Record<string, YamlValue> = {};
  for (const combo of combos) {
    configs[Object.values(combo).map(String).join("_")] = combo;
  }
  return configs;
}

/** Render an Azure Pipelines object. */
function azure(pipeline: CiPipeline): YamlValue {
  const triggers = pipeline.triggers ?? DEFAULT_TRIGGERS;
  const config: Record<string, YamlValue> = {};
  // An empty branch array means "every branch" — Azure spells that `*`.
  const include = (branches: string[]) =>
    branches.length > 0 ? branches : ["*"];
  if (triggers.push) {
    config.trigger = { branches: { include: include(triggers.push) } };
  } else if (triggers.manual) config.trigger = "none";
  if (triggers.pullRequest) {
    config.pr = { branches: { include: include(triggers.pullRequest) } };
  }
  if (triggers.schedule && triggers.schedule.length > 0) {
    for (const entry of triggers.schedule) {
      if (scheduleNeedsGuard(entry)) {
        throw new Error(
          "cicd: Azure Pipelines schedules are UTC-only and Zuke's daylight-" +
            "saving guard is GitHub-only. Use a fixed-offset timezone, or write " +
            "the cron in UTC, for the azure provider.",
        );
      }
    }
    const scheduleBranches = triggers.push ? include(triggers.push) : ["main"];
    config.schedules = [...new Set(triggers.schedule.flatMap(utcCronsFor))].map(
      (cron) => ({
        cron,
        branches: { include: scheduleBranches },
        always: true,
      }),
    );
  }

  const jobs: YamlValue[] = [];
  for (const job of pipeline.jobs ?? DEFAULT_JOBS) {
    const steps: YamlValue[] = [];
    for (const step of job.steps ?? DEFAULT_STEPS) {
      if (step.run !== undefined) {
        steps.push({
          script: step.run,
          displayName: step.name,
          env: step.env,
        });
      }
    }
    jobs.push({
      job: job.id ?? DEFAULT_JOB_ID,
      displayName: job.name,
      pool: { vmImage: job.runsOn ?? DEFAULT_RUNNER },
      dependsOn: job.needs,
      condition: job.if,
      timeoutInMinutes: job.timeoutMinutes,
      strategy: job.matrix ? { matrix: azureMatrix(job.matrix) } : undefined,
      variables: job.env,
      steps,
    });
  }
  config.jobs = jobs;
  return config;
}

/**
 * Render a Bitbucket Pipelines object. Bitbucket's model is a set of trigger
 * sections (`pull-requests`, `branches`, `default`, `custom`) each holding an
 * ordered list of steps; there's no job DAG, no matrix, and no per-step env in
 * the YAML (repository/workspace variables flow in as env automatically), so
 * `needs`, `matrix`, `if`, and step `env` are ignored here.
 */
function bitbucket(pipeline: CiPipeline): YamlValue {
  const triggers = pipeline.triggers ?? DEFAULT_TRIGGERS;
  const steps: YamlValue[] = [];
  for (const job of pipeline.jobs ?? DEFAULT_JOBS) {
    steps.push({
      step: {
        name: job.name,
        image: job.runsOn,
        "max-time": job.timeoutMinutes,
        script: runCommands(job.steps ?? DEFAULT_STEPS),
      },
    });
  }
  // An empty branch array means "every branch" — Bitbucket spells that `**`.
  const patterns = (branches: string[]) =>
    branches.length > 0 ? branches : ["**"];

  const pipelines: Record<string, YamlValue> = {};
  if (triggers.pullRequest) {
    const prs: Record<string, YamlValue> = {};
    for (const p of patterns(triggers.pullRequest)) prs[p] = steps;
    pipelines["pull-requests"] = prs;
  }
  if (triggers.push) {
    if (triggers.push.length > 0) {
      const branches: Record<string, YamlValue> = {};
      for (const b of triggers.push) branches[b] = steps;
      pipelines.branches = branches;
    } else {
      pipelines.default = steps; // runs on every push
    }
  }
  if (triggers.manual) pipelines.custom = { "ai-review": steps };
  // Each step carries its own `image` (from `runsOn`); a step without one falls
  // back to Bitbucket's default image.
  return { pipelines };
}

/**
 * Render `pipeline` as the YAML configuration for `provider`:
 * `.github/workflows/*.yml`, `.gitlab-ci.yml`, `azure-pipelines.yml`, or
 * `bitbucket-pipelines.yml`. The pipeline may be empty (`{}`) to accept every
 * default.
 */
export function generateCi(
  pipeline: CiPipeline,
  provider: CiProvider,
): string {
  switch (provider) {
    case "github":
      return toYaml(github(pipeline));
    case "gitlab":
      return toYaml(gitlab(pipeline));
    case "azure":
      return toYaml(azure(pipeline));
    case "bitbucket":
      return toYaml(bitbucket(pipeline));
  }
}

/**
 * Options for {@link fanOutPipeline}: how a build's targets become parallel CI
 * jobs.
 */
export interface FanOutOptions {
  /**
   * The command a job runs for its target, given the target name. Defaults to
   * the `./zuke <target>` launcher (which bootstraps Deno). Each job runs only
   * its own target; its dependencies run in their own jobs and are shared via
   * the {@link "./remote_cache.ts" | remote cache}, so pair fan-out with one.
   */
  command?: (target: string) => string;
  /**
   * Steps prepended to every job — checkout, tool setup, cache restore. Defaults
   * to a single `actions/checkout` (rendered on GitHub; GitLab and Azure check
   * out automatically). Provide `env` for `ZUKE_REMOTE_CACHE_*` here or via
   * {@link env}.
   */
  setupSteps?: CiStep[];
  /** The runner for every job (see {@link CiJob.runsOn}). */
  runsOn?: string;
  /** Include targets hidden from `--list` via `.unlisted()`. Defaults to false. */
  includeUnlisted?: boolean;
  /** Environment variables set on every job (e.g. the remote-cache config). */
  env?: Record<string, string>;
}

/** The default per-job setup: check out the repo (GitHub only; others auto-checkout). */
const DEFAULT_SETUP_STEPS: CiStep[] = [{ uses: "actions/checkout@v4" }];

/** A CI-safe job id derived from a (possibly dotted) target name. */
function jobId(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "-");
}

/**
 * Expand a build's target graph into a **fanned-out** pipeline: one CI job per
 * runnable target, wired together with `needs:` edges that mirror the targets'
 * `dependsOn` dependencies — so independent targets run in parallel and a
 * target's job waits for its prerequisites. Each job runs just its own target;
 * upstream outputs are shared through the {@link "./remote_cache.ts" | remote
 * cache}, so configure one (e.g. `ZUKE_REMOTE_CACHE_*` on the jobs) to avoid
 * rebuilding dependencies in every job.
 *
 * `base` contributes the pipeline-level fields (name, triggers, permissions,
 * concurrency); its `jobs` are ignored in favour of the generated ones. Targets
 * with no body, and (unless {@link FanOutOptions.includeUnlisted}) `unlisted`
 * targets, are omitted, and `needs` edges to omitted targets are dropped.
 */
export function fanOutPipeline(
  targets: Map<string, TargetBuilder>,
  base: CiPipeline = {},
  options: FanOutOptions = {},
): CiPipeline {
  const command = options.command ?? ((target) => `./zuke ${target}`);
  const setup = options.setupSteps ?? DEFAULT_SETUP_STEPS;
  const included = new Map<string, TargetBuilder>();
  for (const [name, t] of targets) {
    if (t.fn_ === undefined) continue; // nothing to run
    if (t.unlisted_ && !options.includeUnlisted) continue;
    included.set(name, t);
  }

  const jobs: CiJob[] = [];
  for (const [name, t] of included) {
    const needs = t.dependsOn_
      .map((d) => d.name_)
      .filter((n): n is string => n !== undefined && included.has(n))
      .map(jobId);
    jobs.push({
      id: jobId(name),
      name: t.description_ ?? name,
      runsOn: options.runsOn,
      needs: needs.length > 0 ? needs : undefined,
      env: options.env,
      steps: [...setup, { name: `Run ${name}`, run: command(name) }],
    });
  }

  return {
    name: base.name,
    triggers: base.triggers,
    permissions: base.permissions,
    concurrency: base.concurrency,
    jobs,
  };
}

/** A CI configuration file declared on a build: a pipeline bound to a path. */
export interface CiFileSpec {
  /** The provider to render for — the one field you must choose. */
  provider: CiProvider;
  /**
   * The output path (relative to the working directory). Defaults to the
   * provider's conventional location (`.github/workflows/ci.yml`,
   * `.gitlab-ci.yml`, or `azure-pipelines.yml`).
   */
  path?: string;
  /** The pipeline to render. Defaults to a single `build` job that runs the build. */
  pipeline?: CiPipeline;
  /**
   * Fan the build's targets out into one CI job per target, wired by their
   * dependencies (see {@link fanOutPipeline}). `true` uses the defaults; pass
   * {@link FanOutOptions} to customise. When set, {@link pipeline} supplies the
   * pipeline-level fields (name, triggers, …) and its `jobs` are ignored.
   */
  fanOut?: boolean | FanOutOptions;
}

/**
 * A declared CI file. Assign one (via {@link cicd}) to a build field and Zuke
 * keeps the file on disk in sync with the definition when the build runs.
 */
export class CiFile {
  /** The provider this file renders for. */
  readonly provider: CiProvider;
  /** The output path. */
  readonly path: string;
  /** The base pipeline (pipeline-level fields, and the jobs unless fanning out). */
  readonly pipeline: CiPipeline;
  /** Fan-out options, when this file expands the build's targets into jobs. */
  readonly fanOut?: FanOutOptions;

  /** Build the CI file from its spec, filling in the provider's default path. */
  constructor(spec: CiFileSpec) {
    this.provider = spec.provider;
    this.path = spec.path ?? DEFAULT_PATHS[this.provider];
    this.pipeline = spec.pipeline ?? {};
    if (spec.fanOut === true) this.fanOut = {};
    else if (spec.fanOut) this.fanOut = spec.fanOut;
  }

  /**
   * The pipeline this file renders. With fan-out, the build's `targets` are
   * expanded into one job per target; otherwise the declared {@link pipeline}.
   */
  pipelineFor(targets: Map<string, TargetBuilder>): CiPipeline {
    return this.fanOut === undefined
      ? this.pipeline
      : fanOutPipeline(targets, this.pipeline, this.fanOut);
  }

  /** Render the file's YAML content (the base pipeline; fan-out is resolved at discovery). */
  render(): string {
    return generateCi(this.pipeline, this.provider);
  }
}

/**
 * Declare a CI file as a build field. Running the build regenerates it (and the
 * `generate-ci` command writes it on demand), so the committed configuration is
 * generated from code rather than hand-maintained.
 *
 * The provider is the only required field: `cicd({ provider: "github" })`
 * declares a workflow at `.github/workflows/ci.yml` that runs the build on
 * push/PR to `main`. Override only what else you need.
 *
 * ```ts
 * class MyBuild extends Build {
 *   ci = cicd({ provider: "github" }); // sensible default workflow
 *   // …or customise:
 *   gitlab = cicd({ provider: "gitlab", pipeline: { jobs: [{ steps: [...] }] } });
 * }
 * ```
 */
export function cicd(spec: CiFileSpec): CiFile {
  return new CiFile(spec);
}

/**
 * Find every {@link CiFile} declared on a build instance. A fan-out file is
 * resolved here — its jobs are expanded from the build's targets — so the
 * returned files render the same whether they fan out or not.
 */
export function discoverCiFiles(build: Build): CiFile[] {
  const found: CiFile[] = [];
  forEachField(build, (_path, value) => {
    if (value instanceof CiFile) found.push(value);
  });
  if (!found.some((f) => f.fanOut !== undefined)) return found;
  const targets = discoverTargets(build);
  return found.map((f) =>
    f.fanOut === undefined ? f : new CiFile({
      provider: f.provider,
      path: f.path,
      pipeline: f.pipelineFor(targets),
    })
  );
}

/** What {@link syncCiFiles} did to a file. */
export type CiSyncStatus = "written" | "unchanged" | "stale";

/** The outcome of syncing one {@link CiFile}. */
export interface CiSyncResult {
  /** The file's path. */
  path: string;
  /** Whether it was written, already current, or (in check mode) out of date. */
  status: CiSyncStatus;
}

/** Filesystem seams for {@link syncCiFiles} (overridable for tests). */
export interface CiSyncOptions {
  /**
   * Verify instead of write: report an out-of-date file as `stale` rather than
   * overwriting it. Intended for CI, where committed config must match the build.
   */
  check?: boolean;
  /** Read a file's contents, or `null` when it does not exist. */
  read?: (path: string) => Promise<string | null>;
  /** Write a file, creating parent directories as needed. */
  write?: (path: string, content: string) => Promise<void>;
}

/** Default reader: the file's text, or `null` when it is absent. */
async function readOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/** Default writer: create the parent directory, then write the file. */
async function writeFile(path: string, content: string): Promise<void> {
  const slash = path.replace(/\\/g, "/").lastIndexOf("/");
  if (slash !== -1) await Deno.mkdir(path.slice(0, slash), { recursive: true });
  await Deno.writeTextFile(path, content);
}

/**
 * Bring each declared {@link CiFile} on disk in line with its definition. By
 * default a changed file is rewritten; in `check` mode it is reported `stale`
 * instead (so CI can fail when the committed config has drifted).
 */
export async function syncCiFiles(
  files: readonly CiFile[],
  options: CiSyncOptions = {},
): Promise<CiSyncResult[]> {
  const read = options.read ?? readOrNull;
  const write = options.write ?? writeFile;
  const results: CiSyncResult[] = [];
  for (const file of files) {
    const content = file.render();
    // Normalise CRLF→LF on read so a Windows checkout (where git's autocrlf
    // converts line endings) compares equal to the always-LF rendered output.
    const onDisk = await read(file.path);
    if (onDisk !== null && onDisk.replace(/\r\n/g, "\n") === content) {
      results.push({ path: file.path, status: "unchanged" });
    } else if (options.check) {
      results.push({ path: file.path, status: "stale" });
    } else {
      await write(file.path, content);
      results.push({ path: file.path, status: "written" });
    }
  }
  return results;
}
