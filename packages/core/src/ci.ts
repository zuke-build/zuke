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
import { type Build, forEachField } from "./build.ts";

/** The CI providers {@link generateCi} can target. */
export type CiProvider = "github" | "gitlab" | "azure";

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
      needs: job.needs,
      if: job.if,
      "timeout-minutes": job.timeoutMinutes,
      strategy: job.matrix ? { matrix: job.matrix } : undefined,
      env: job.env,
      steps,
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
 * Render `pipeline` as the YAML configuration for `provider`:
 * `.github/workflows/*.yml`, `.gitlab-ci.yml`, or `azure-pipelines.yml`. The
 * pipeline may be empty (`{}`) to accept every default.
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
  }
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
  /** The pipeline this file renders. */
  readonly pipeline: CiPipeline;

  constructor(spec: CiFileSpec) {
    this.provider = spec.provider;
    this.path = spec.path ?? DEFAULT_PATHS[this.provider];
    this.pipeline = spec.pipeline ?? {};
  }

  /** Render the file's YAML content. */
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

/** Find every {@link CiFile} declared on a build instance. */
export function discoverCiFiles(build: Build): CiFile[] {
  const files: CiFile[] = [];
  forEachField(build, (_path, value) => {
    if (value instanceof CiFile) files.push(value);
  });
  return files;
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
