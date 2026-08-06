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

import { annotated, toYaml, type YamlValue } from "./yaml.ts";
import { type Build, discoverTargets, forEachField } from "./build.ts";
import { TargetBuilder } from "./target.ts";
import {
  anyScheduleNeedsGuard,
  guardShell,
  type ScheduleEntry,
  scheduleNeedsGuard,
  utcCronsFor,
} from "./ci_schedule.ts";

/** The CI providers {@link generateCi} can target. */
export type CiProvider = "github" | "gitlab" | "azure" | "bitbucket";

/**
 * A pinned action reference, and the version its commit corresponds to.
 *
 * The version is emitted as a trailing `# v1.2.3` comment, which is not
 * decoration: Dependabot reads it to know which version a pinned SHA is, and
 * rewrites both together when it bumps. A generated workflow that dropped it
 * would leave automated bumps with no version to track.
 */
export interface CiActionRef {
  /** The pinned reference, `owner/repo@<sha>`. */
  ref: string;
  /** The version the SHA corresponds to, e.g. `v7.0.1`. */
  version?: string;
}

/** A step's `uses:` value — a bare reference, or one carrying its version. */
export type CiUses = string | CiActionRef;

/** Render a `uses:` value, attaching the version comment when there is one. */
function usesValue(uses: CiUses): YamlValue {
  if (typeof uses === "string") return uses;
  return uses.version === undefined
    ? uses.ref
    : annotated(uses.ref, uses.version);
}

/** A single step in a job. */
export interface CiStep {
  /** Human-readable step name. */
  name?: string;
  /**
   * A stable identifier for the step, so later steps can read its outputs
   * (`${{ steps.<id>.outputs.x }}`). GitHub only.
   */
  id?: string;
  /**
   * A condition gating this step — a raw provider expression, e.g.
   * `runner.os == 'Windows'` or `always()`. GitHub only.
   */
  if?: string;
  /**
   * The shell to run `run` with (`bash`, `pwsh`, `sh`, …). Omit for the runner's
   * default, which differs per OS. GitHub only.
   */
  shell?: string;
  /** Continue the job even when this step fails (`continue-on-error`). GitHub only. */
  continueOnError?: boolean;
  /** A shell command to run. Portable across all providers. */
  run?: string;
  /**
   * A GitHub Action reference (e.g. `actions/checkout@v4`). Rendered only for
   * GitHub; skipped for GitLab and Azure.
   */
  uses?: CiUses;
  /** Inputs for a {@link uses} Action (GitHub only). */
  with?: Record<string, string>;
  /**
   * Environment variables for this step. Rendered as `env:` on GitHub Actions
   * and on Azure Pipelines `script` steps; ignored on GitLab (which sources
   * variables from project settings, not the job YAML).
   */
  env?: Record<string, string>;
}

/**
 * Runner hardening, emitted as a `step-security/harden-runner` step before
 * anything else in the job.
 *
 * This cannot move into the build: the point of the step is to install an egress
 * control *before* build code runs, so a build that set it up itself would be
 * the very code it is meant to contain. Generating it is the next best thing —
 * the policy is declared in one place, in code, next to the job it protects.
 *
 * The pinned {@link action} reference is required rather than defaulted. A
 * default would mean either a floating tag (which supply-chain scanners reject
 * as an unpinned use) or a commit SHA baked into `@zuke/core` that goes stale
 * between releases. Passing it makes the pin the caller's — and lets a build
 * source it from wherever its bumps are automated.
 */
export interface CiHardenRunner {
  /**
   * The pinned action reference, e.g. `step-security/harden-runner@<sha>`.
   * Omit it when the file supplies a {@link CiFileSpec.pins} resolver, which is
   * the better arrangement: the SHA is then stated once for the repository
   * rather than at every use.
   */
  action?: CiUses;
  /**
   * `"audit"` records outbound connections; `"block"` drops everything outside
   * {@link allowedEndpoints}. Defaults to `"audit"` — the safe choice for a job
   * with no secrets, where a false block would be worse than an unrecorded call.
   */
  egress?: "audit" | "block";
  /**
   * The hosts a `"block"` policy permits, as `host:port`. Ignored when auditing.
   * Every entry should be traceable to something the build actually reaches.
   */
  allowedEndpoints?: string[];
  /** The step name. Defaults to `"Harden the runner"`. */
  name?: string;
}

/**
 * The repository checkout, emitted as an `actions/checkout` step after any
 * {@link CiHardenRunner} and before the job's own steps. Like hardening, the
 * pinned {@link action} reference is required.
 */
export interface CiCheckout {
  /** The pinned action reference. Omit it when the file supplies a `pins` resolver. */
  action?: CiUses;
  /**
   * Keep the token in git config so a later step can push. Defaults to `false`:
   * a job that does not push should not leave a credential behind.
   */
  persistCredentials?: boolean;
  /** The ref to check out. Defaults to the one that triggered the run. */
  ref?: string;
  /**
   * How much history to fetch. `0` means the full history — needed by anything
   * that walks past commits, such as a secret scan.
   */
  fetchDepth?: number;
  /** The step name. Defaults to `"Checkout"`. */
  name?: string;
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
  /**
   * Let the other matrix legs finish when one fails (`fail-fast: false`). Default
   * GitHub behaviour cancels them, which hides whether a failure is
   * platform-specific — the thing a cross-OS matrix exists to answer.
   */
  failFast?: boolean;
  /**
   * The token permissions this job's `GITHUB_TOKEN` carries. Set it per job
   * rather than pipeline-wide so a job holds only what it needs — the isolation
   * that lets one job push commits while another only reads. GitHub only.
   */
  permissions?: Record<string, string>;
  /**
   * Harden the runner before this job's steps. Overrides
   * {@link CiPipeline.harden}; pass `false` to opt this job out of a
   * pipeline-wide default.
   */
  harden?: CiHardenRunner | false;
  /**
   * Check the repository out before this job's steps. Overrides
   * {@link CiPipeline.checkout}; pass `false` to opt out.
   */
  checkout?: CiCheckout | false;
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
  /**
   * Which pull-request activity types fire the pipeline, on top of the branch
   * filter — GitHub's default is `opened`, `synchronize`, `reopened`. Add
   * `edited` when a gate reads the pull request's own description, since editing
   * it changes what a check should see without pushing a commit. GitHub only.
   */
  pullRequestTypes?: string[];
  /** Allow manual runs (workflow dispatch / web). */
  manual?: boolean;
  /**
   * Run when a branch protection rule is created, edited, or deleted
   * (`branch_protection_rule`) — a supply-chain scan wants to re-score when the
   * repository's own protections change. GitHub only.
   */
  branchProtectionRule?: boolean;
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
   *
   * Defaults to `{ contents: "read" }` — least privilege, and what a workflow
   * that only reads the repository needs. A job that needs more declares it, so
   * the wider scope sits next to the job that justifies it. Pass `{}` for no
   * permissions at all, which is stricter than the default rather than absent.
   */
  permissions?: Record<string, string>;
  /** Limit concurrent runs (GitHub only). Ignored elsewhere. */
  concurrency?: CiConcurrency;
  /**
   * Harden every job's runner, unless a job overrides it or opts out with
   * `harden: false`. Declared once here rather than repeated per job, since the
   * policy is usually uniform across a workflow. GitHub only.
   */
  harden?: CiHardenRunner;
  /**
   * Check the repository out in every job, unless a job overrides it or opts out
   * with `checkout: false`. GitHub only.
   */
  checkout?: CiCheckout;
  /** The jobs to run. Defaults to a single `build` job that runs the build. */
  jobs?: CiJob[];
}

/** The default runner image used when a job does not set {@link CiJob.runsOn}. */
const DEFAULT_RUNNER = "ubuntu-latest";

/**
 * Least-privilege workflow permissions: read the repository, nothing more. A job
 * that needs to write declares it, so the wider scope is stated where it is used.
 */
const DEFAULT_PERMISSIONS: Record<string, string> = { contents: "read" };

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
 * or `{}` (no filter — every branch) for an empty one. `types` is added when the
 * trigger declares activity types.
 */
function githubTrigger(branches: string[], types?: string[]): YamlValue {
  const filter: Record<string, YamlValue> = {};
  if (branches.length > 0) filter.branches = branches;
  if (types !== undefined && types.length > 0) filter.types = types;
  return filter;
}

/**
 * Fill in any action reference a resolver can supply, and default the prelude
 * itself: with pins available, every job is hardened and checked out unless it
 * says otherwise, because that is the prelude nearly every job needs.
 */
function withPins(pipeline: CiPipeline, pins?: CiPinResolver): CiPipeline {
  if (pins === undefined) return pipeline;
  const harden = pipeline.harden ?? {};
  const checkout = pipeline.checkout ?? {};
  return {
    ...pipeline,
    harden: { ...harden, action: harden.action ?? pins(HARDEN_RUNNER_ACTION) },
    checkout: {
      ...checkout,
      action: checkout.action ?? pins(CHECKOUT_ACTION),
    },
    jobs: pipeline.jobs?.map((job) => ({
      ...job,
      harden: job.harden
        ? {
          ...job.harden,
          action: job.harden.action ?? pins(HARDEN_RUNNER_ACTION),
        }
        : job.harden,
      checkout: job.checkout
        ? {
          ...job.checkout,
          action: job.checkout.action ?? pins(CHECKOUT_ACTION),
        }
        : job.checkout,
    })),
  };
}

/** The `harden-runner` step a job's {@link CiHardenRunner} describes. */
function hardenStep(harden: CiHardenRunner): CiStep {
  const inputs: Record<string, string> = {
    "egress-policy": harden.egress ?? "audit",
  };
  const allowed = harden.allowedEndpoints ?? [];
  if (allowed.length > 0) {
    // Space-separated on one line, which is exactly what the folded scalar
    // (`allowed-endpoints: >`) in every hand-written example collapses to. The
    // action passes this input to its agent as an opaque string and documents no
    // delimiter, so the safe choice for the control that gates a secret-bearing
    // job is the form already known to enforce correctly — not a newline-
    // separated list that merely looks tidier.
    inputs["allowed-endpoints"] = allowed.join(" ");
  }
  if (harden.action === undefined) {
    throw new Error(
      `cicd: hardening needs a pinned action — set \`action\` on it, or give ` +
        `the file a \`pins\` resolver so it can be looked up once.`,
    );
  }
  return {
    name: harden.name ?? "Harden the runner",
    uses: harden.action,
    with: inputs,
  };
}

/** The `checkout` step a job's {@link CiCheckout} describes. */
function checkoutStep(checkout: CiCheckout): CiStep {
  const inputs: Record<string, string> = {
    // Always explicit: whether a checkout leaves a usable credential behind is
    // exactly the kind of thing that should not be left to a default.
    "persist-credentials": String(checkout.persistCredentials ?? false),
  };
  if (checkout.ref !== undefined) inputs.ref = checkout.ref;
  if (checkout.fetchDepth !== undefined) {
    inputs["fetch-depth"] = String(checkout.fetchDepth);
  }
  if (checkout.action === undefined) {
    throw new Error(
      `cicd: the checkout needs a pinned action — set \`action\` on it, or ` +
        `give the file a \`pins\` resolver so it can be looked up once.`,
    );
  }
  return {
    name: checkout.name ?? "Checkout",
    uses: checkout.action,
    with: inputs,
  };
}

/**
 * A job's steps, with the hardening and checkout preludes prepended in the only
 * order that works: hardening must precede the checkout (it is what constrains
 * everything after it), and the checkout must precede the build.
 */
function jobSteps(job: CiJob, pipeline: CiPipeline): CiStep[] {
  const harden = job.harden === undefined ? pipeline.harden : job.harden;
  const checkout = job.checkout === undefined
    ? pipeline.checkout
    : job.checkout;
  return [
    ...(harden ? [hardenStep(harden)] : []),
    ...(checkout ? [checkoutStep(checkout)] : []),
    ...(job.steps ?? DEFAULT_STEPS),
  ];
}

/** Render a GitHub Actions workflow object. */
function github(pipeline: CiPipeline): YamlValue {
  const triggers = pipeline.triggers ?? DEFAULT_TRIGGERS;
  const on: Record<string, YamlValue> = {};
  if (triggers.push) on.push = githubTrigger(triggers.push);
  if (triggers.pullRequest) {
    on.pull_request = githubTrigger(
      triggers.pullRequest,
      triggers.pullRequestTypes,
    );
  }
  if (triggers.manual) on.workflow_dispatch = {};
  if (triggers.branchProtectionRule) on.branch_protection_rule = {};
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
    const steps = jobSteps(job, pipeline).map((step): YamlValue => ({
      name: step.name,
      id: step.id,
      if: step.if,
      uses: step.uses === undefined ? undefined : usesValue(step.uses),
      with: step.with,
      shell: step.shell,
      run: step.run,
      env: step.env,
      "continue-on-error": step.continueOnError,
    }));
    jobs[job.id ?? DEFAULT_JOB_ID] = {
      name: job.name,
      "runs-on": matrixOs ? "${{ matrix.os }}" : (job.runsOn ?? DEFAULT_RUNNER),
      permissions: job.permissions,
      // A guarded schedule makes every job wait on the guard and run only when
      // the guard cleared this firing (the correct wall-clock, or a non-schedule
      // event).
      needs: guarded ? [...(job.needs ?? []), GUARD_JOB_ID] : job.needs,
      if: guarded ? guardedIf(job.if) : job.if,
      "timeout-minutes": job.timeoutMinutes,
      strategy: job.matrix
        ? {
          // `fail-fast` only when explicitly declared, so an existing matrix
          // keeps GitHub's default rather than gaining a redundant `true`.
          "fail-fast": job.failFast,
          matrix: job.matrix,
        }
        : undefined,
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
    permissions: pipeline.permissions ?? DEFAULT_PERMISSIONS,
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

/**
 * The workflow path a field name implies: `releaseWorkflow` →
 * `.github/workflows/release.yml`.
 *
 * A trailing `Workflow`, `Ci`, or `Yaml` is noise once the file is a workflow,
 * and camelCase reads better as kebab-case in a filename. A name that reduces to
 * nothing (a field called just `workflow`) keeps the provider's default.
 */
function pathForField(field: string, provider: CiProvider): string {
  const leaf = field.split(".").pop() ?? field;
  const base = leaf
    .replace(/(Workflow|Ci|Yaml|Yml)$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  if (base === "") return DEFAULT_PATHS[provider];
  const dir = DEFAULT_PATHS[provider].replace(/\/[^/]+$/, "");
  return provider === "github" ? `${dir}/${base}.yml` : DEFAULT_PATHS[provider];
}

/** A CI-safe job id derived from a (possibly dotted) target name. */
function jobId(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "-");
}

/** The command an invoked job runs: the launcher, which bootstraps Deno itself. */
const DEFAULT_INVOKE_COMMAND = (target: string) => `./zuke ${target}`;

/** Normalise an invocation, so a bare target reads as one with no overrides. */
function invocationOf(invokes: CiInvokes): CiInvocation {
  return invokes instanceof TargetBuilder ? { target: invokes } : invokes;
}

/**
 * The name a target was discovered under, by identity.
 *
 * Targets are declared as class fields and named by {@link discoverTargets}
 * after construction, so a `cicd({...})` field initialiser holds a reference
 * whose name is not yet assigned. Resolving by identity at render time is what
 * lets a workflow be declared with `this.ci` rather than `"ci"`.
 */
function nameOf(
  target: TargetBuilder,
  targets: Map<string, TargetBuilder>,
): string | undefined {
  if (target.name_ !== undefined) return target.name_;
  for (const [name, candidate] of targets) {
    if (candidate === target) return name;
  }
  return undefined;
}

/**
 * Expand invoked targets into one job each: id, display name, `needs:` edges,
 * and the command all derived from the build graph.
 *
 * `needs:` covers only edges between *invoked* targets. A dependency that is not
 * itself a job is not an edge — it runs inside its dependant's own process, the
 * way `./zuke ci` runs the whole gate locally.
 */
function invokedPipeline(
  invokes: readonly CiInvokes[],
  targets: Map<string, TargetBuilder>,
  base: CiPipeline,
  command: (target: string) => string,
): CiPipeline {
  const resolved = invokes.map((i) => {
    const invocation = invocationOf(i);
    const name = nameOf(invocation.target, targets);
    if (name === undefined) {
      throw new Error(
        `cicd: an invoked target is not a field on this build, so it has no ` +
          `name to run. Pass a target declared on the build (\`this.<field>\`).`,
      );
    }
    return { invocation, name };
  });

  const invokedNames = new Set(resolved.map((r) => r.name));
  const jobs: CiJob[] = resolved.map(({ invocation, name }) => {
    // Edges the build graph already implies, plus any explicitly ordered after.
    const implied = invocation.target.dependsOn_
      .map((d) => nameOf(d, targets))
      .filter((n): n is string => n !== undefined && invokedNames.has(n));
    const explicit = (invocation.after ?? [])
      .map((d) => nameOf(d, targets))
      .filter((n): n is string => n !== undefined);
    const needs = [...new Set([...implied, ...explicit])].map(jobId);

    const run = invocation.steps ??
      [{
        name: `Run ${name} with Zuke`,
        run: command(name),
        env: invocation.env,
      }];

    return {
      id: invocation.id ?? jobId(name),
      name: invocation.name ?? invocation.target.description_ ?? name,
      runsOn: invocation.runsOn,
      needs: needs.length > 0 ? needs : undefined,
      matrix: invocation.matrix,
      failFast: invocation.failFast,
      permissions: invocation.permissions,
      timeoutMinutes: invocation.timeoutMinutes,
      harden: invocation.harden,
      checkout: invocation.checkout,
      if: invocation.if,
      steps: [
        ...(invocation.before ?? []),
        ...run,
        ...(invocation.then ?? []),
      ],
    };
  });

  return { ...base, jobs };
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

/**
 * One job's worth of a workflow, derived from a target.
 *
 * A job's shape is almost entirely implied by the target it runs: the id and
 * display name come from the target, the command is `./zuke <target>`, and the
 * `needs:` edges come from the target's `dependsOn`. So an invoked target
 * usually needs nothing said about it at all — pass the target and the job is
 * generated.
 *
 * The fields here are the residue that genuinely cannot be inferred, because
 * they are properties of the *runner* rather than of the work: which OS matrix
 * to fan out over, which token scopes the job needs, how much egress to permit,
 * how long to allow. Set one only when the default is wrong.
 */
export interface CiInvocation {
  /** The target this job runs. */
  target: TargetBuilder;
  /** Override the job id (defaults to the target's name, CI-sanitised). */
  id?: string;
  /** Override the display name (defaults to the target's description, else its name). */
  name?: string;
  /** The runner, when it differs from the pipeline default. */
  runsOn?: string;
  /** A build matrix — fanning one target out over several OSes, say. */
  matrix?: Record<string, Array<string | number>>;
  /** Let the other matrix legs finish when one fails. */
  failFast?: boolean;
  /** The token permissions this job needs (see {@link CiJob.permissions}). */
  permissions?: Record<string, string>;
  /** Fail the job after this many minutes. */
  timeoutMinutes?: number;
  /** Harden this job's runner, overriding the pipeline default. */
  harden?: CiHardenRunner | false;
  /** Check out in this job, overriding the pipeline default. */
  checkout?: CiCheckout | false;
  /** A condition gating the job. */
  if?: string;
  /**
   * Environment variables for the target's own step — where a secret is mapped
   * in, e.g. `{ GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }`.
   */
  env?: Record<string, string>;
  /**
   * Extra `needs:` edges beyond those implied by the target's `dependsOn`. Use
   * it to order two invoked targets that are independent in the build graph but
   * must not run concurrently in CI.
   */
  after?: readonly TargetBuilder[];
  /** Steps to run before the target, for something no target can do (see below). */
  before?: CiStep[];
  /** Steps to run after the target. */
  then?: CiStep[];
  /**
   * Replace the generated `./zuke <target>` step entirely. The escape hatch of
   * last resort — prefer {@link before}/{@link then}, and prefer moving the work
   * into the target over either.
   */
  steps?: CiStep[];
}

/** A target to invoke, bare when the derived job needs no adjustment. */
export type CiInvokes = TargetBuilder | CiInvocation;

/**
 * Resolves an action's pinned reference by name, e.g. `"actions/checkout"`.
 *
 * Supplying one is what lets a workflow declare hardening and checkout by
 * *intent* rather than by repeating a SHA at every use. Without it each
 * {@link CiHardenRunner} and {@link CiCheckout} must carry its own `action`.
 */
export type CiPinResolver = (action: string) => CiUses;

/** The action a {@link CiHardenRunner} is generated from when pins are resolved. */
export const HARDEN_RUNNER_ACTION = "step-security/harden-runner";

/** The action a {@link CiCheckout} is generated from when pins are resolved. */
export const CHECKOUT_ACTION = "actions/checkout";

/** A CI configuration file declared on a build: a pipeline bound to a path. */
export interface CiFileSpec {
  /**
   * The provider to render for. Defaults to `"github"`, which is what the
   * `.github/workflows` default path assumes anyway.
   */
  provider?: CiProvider;
  /**
   * Resolves each action's pinned reference by name, so hardening and checkout
   * can be requested without restating a SHA.
   *
   * With a resolver, every job is hardened and checked out by default — the
   * prelude nearly every job needs — and a job opts out with `harden: false` or
   * adjusts the policy without naming the action again.
   */
  pins?: CiPinResolver;
  /**
   * The output path (relative to the working directory).
   *
   * Defaults to the **field name** the file is declared on, in the provider's
   * conventional directory: `releaseWorkflow = cicd({...})` writes
   * `.github/workflows/release.yml`. A trailing `Workflow`/`Ci`/`Yaml` is
   * dropped, and camelCase becomes kebab-case. Recovering the name from the
   * field is how `target()` works too, so a workflow needs no more ceremony
   * than a target.
   *
   * Falls back to the provider's single conventional file
   * (`.github/workflows/ci.yml`, `.gitlab-ci.yml`, …) when the name is not
   * available — a file built outside a build class.
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
  /**
   * The targets this workflow runs — one job each, in place of hand-written
   * {@link CiPipeline.jobs}.
   *
   * This is the intended way to declare a workflow. A job is almost entirely
   * implied by its target, so naming the targets is usually the whole
   * declaration: the id, the display name, the `./zuke <target>` command, and
   * the `needs:` edges between jobs all come from the build graph. Pass a
   * {@link CiInvocation} instead of a bare target only for what the runner
   * decides rather than the build — a matrix, token scopes, an egress policy.
   *
   * Each job runs its target's *whole* subgraph in one process, exactly as
   * `./zuke <target>` does locally — so dependencies inside a target run
   * in-process and need no cache to share their output. Use {@link fanOut}
   * instead to give every target in the graph its own job, which does need a
   * remote cache.
   *
   * Targets are passed as references (`this.ci`), not names, so a rename is a
   * compile error rather than a workflow that silently runs nothing. As with
   * `dependsOn`, that means the declaration must appear **below** the targets it
   * invokes — class fields initialise top-to-bottom, so a forward reference is
   * `undefined`. Declaring workflows last is the simplest way to satisfy it.
   */
  invokes?: readonly CiInvokes[];
}

/**
 * A declared CI file. Assign one (via {@link cicd}) to a build field and Zuke
 * keeps the file on disk in sync with the definition when the build runs.
 */
export class CiFile {
  /** The provider this file renders for. */
  readonly provider: CiProvider;
  /** The output path, once resolved. */
  readonly path: string;
  /** Whether {@link path} came from the spec rather than a default. */
  readonly explicitPath: boolean;
  /** The base pipeline (pipeline-level fields, and the jobs unless fanning out). */
  readonly pipeline: CiPipeline;
  /** Fan-out options, when this file expands the build's targets into jobs. */
  readonly fanOut?: FanOutOptions;
  /** The targets this file runs as jobs, when declared with `invokes`. */
  readonly invokes?: readonly CiInvokes[];
  /** Resolves pinned action references, so a SHA is stated once per repository. */
  readonly pins?: CiPinResolver;

  /** Build the CI file from its spec, filling in the provider's default path. */
  constructor(spec: CiFileSpec) {
    this.provider = spec.provider ?? "github";
    this.path = spec.path ?? DEFAULT_PATHS[this.provider];
    this.explicitPath = spec.path !== undefined;
    this.pipeline = spec.pipeline ?? {};
    if (spec.fanOut === true) this.fanOut = {};
    else if (spec.fanOut) this.fanOut = spec.fanOut;
    this.invokes = spec.invokes;
    this.pins = spec.pins;
    if (this.invokes !== undefined && this.fanOut !== undefined) {
      throw new Error(
        "cicd: use either `invokes` (one job per named target) or `fanOut` " +
          "(one job per target in the graph), not both.",
      );
    }
  }

  /** Whether this file's jobs are derived from the build rather than declared. */
  get derived(): boolean {
    return this.fanOut !== undefined || this.invokes !== undefined;
  }

  /**
   * The pipeline this file renders. Jobs come from the invoked targets, or from
   * a full fan-out of the graph, or — failing both — from the declared
   * {@link pipeline}.
   */
  pipelineFor(targets: Map<string, TargetBuilder>): CiPipeline {
    if (this.invokes !== undefined) {
      return withPins(
        invokedPipeline(
          this.invokes,
          targets,
          this.pipeline,
          DEFAULT_INVOKE_COMMAND,
        ),
        this.pins,
      );
    }
    return withPins(
      this.fanOut === undefined
        ? this.pipeline
        : fanOutPipeline(targets, this.pipeline, this.fanOut),
      this.pins,
    );
  }

  /** The same file bound to `path` — used to name a file from its field. */
  at(path: string): CiFile {
    return new CiFile({
      provider: this.provider,
      path,
      pipeline: this.pipeline,
      pins: this.pins,
      invokes: this.invokes,
      fanOut: this.fanOut,
    });
  }

  /** Render the file's YAML content (the base pipeline; fan-out is resolved at discovery). */
  render(): string {
    return generateCi(withPins(this.pipeline, this.pins), this.provider);
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
  forEachField(build, (field, value) => {
    if (!(value instanceof CiFile)) return;
    found.push(
      value.explicitPath
        ? value
        : value.at(pathForField(field, value.provider)),
    );
  });
  if (!found.some((f) => f.derived)) return found;
  const targets = discoverTargets(build);
  return found.map((f) =>
    !f.derived ? f : new CiFile({
      provider: f.provider,
      path: f.path,
      // Already resolved by pipelineFor, so the rebuilt file needs no resolver.
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
