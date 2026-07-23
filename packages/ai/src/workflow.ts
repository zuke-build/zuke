/**
 * Generate the AI-review CI workflow from declared {@link Reviewer}s. Returns a
 * [`CiFile`](jsr:@zuke/core) — so the standard `cicd` plumbing
 * (`discoverCiFiles`/`syncCiFiles`) keeps it on disk in sync with the build
 * definition, the same way every other generated workflow works.
 *
 * The workflow targets one CI host at a time, mirroring the host the review
 * comments are posted to:
 *
 *   - **GitHub Actions** — a fork-gated PR workflow with harden-runner, pinned
 *     checkout, a base-branch fetch, and `pull-requests: write` when any
 *     reviewer uses `.comment()`. Defaults: `.github/workflows/ai-review.yml`.
 *   - **GitLab CI** — a small merge-request-only job snippet meant to be
 *     `include:`-d from the project's `.gitlab-ci.yml`. Defaults:
 *     `.gitlab/ai-review.gitlab-ci.yml`.
 *   - **Azure Pipelines** — a PR-only job snippet meant to be used as a
 *     template. Defaults: `pipelines/ai-review.azure-pipelines.yml`. Each
 *     reviewer's secret is wired into the script step's `env:` block (Azure
 *     does not expose pipeline secrets as env vars by default).
 *   - **Bitbucket Pipelines** — a `bitbucket-pipelines.yml` whose
 *     `pull-requests` section runs the review. Repository/workspace variables
 *     flow into the step automatically, so no env block is emitted. Bitbucket
 *     has no `include`, so the file lives at the repo root.
 *
 * @module
 */

import {
  type AnyParameter,
  CiFile,
  type CiJob,
  type CiPipeline,
  type CiProvider,
  envVarName,
  generateCi,
} from "@zuke/core";
import type { Reviewer } from "./reviewer.ts";

/** SHA-pinned `step-security/harden-runner` (v2.20.0). */
const HARDEN_RUNNER =
  "step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920";

/** SHA-pinned `actions/checkout` (v7.0.0). */
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";

/** Default output paths per host — see {@link AiReviewWorkflowSpec}. */
const DEFAULT_PATHS: Record<CiProvider, string> = {
  github: ".github/workflows/ai-review.yml",
  // GitLab/Azure root files are typically user-owned; emit a snippet the user
  // includes/templates from their main pipeline so we never clobber it.
  gitlab: ".gitlab/ai-review.gitlab-ci.yml",
  azure: "pipelines/ai-review.azure-pipelines.yml",
  // Bitbucket has no `include` mechanism — the file must be at the repo root.
  bitbucket: "bitbucket-pipelines.yml",
};

/** The Docker image used for the GitLab job — the official Deno image. */
const DENO_IMAGE = "denoland/deno:latest";

/** The conventional workflow name shown in each host's UI. */
const DEFAULT_NAME = "AI Review";

/** The default base branch to diff against (FETCH_HEAD after the fetch step). */
const DEFAULT_BASE_BRANCH = "master";

/** The default build target the workflow runs (`./zuke <target>`). */
const DEFAULT_TARGET = "review";

/** Per-job time cap (matches the original hand-written GitHub workflow). */
const DEFAULT_TIMEOUT_MINUTES = 15;

/** What to generate — only `reviewers` is required. */
export interface AiReviewWorkflowSpec {
  /**
   * The reviewers whose key env vars and `.comment()` setting drive the
   * generated workflow. Each reviewer's `.apiKey(param)` parameter becomes an
   * `env:` entry (or its host equivalent) that maps the secret in; any
   * reviewer with `.comment()` causes the workflow to grant the right
   * commenting scope and pass the host's token env var.
   */
  reviewers: readonly Reviewer[];
  /**
   * The CI host the workflow targets. Defaults to `"github"`. Use `"gitlab"`,
   * `"azure"`, or `"bitbucket"` to generate the equivalent for those hosts.
   */
  host?: CiProvider;
  /** The build target the workflow runs. Defaults to `"review"`. */
  target?: string;
  /**
   * The base branch the diff is taken against (used by the GitHub workflow's
   * fetch step). Defaults to `"master"`.
   */
  baseBranch?: string;
  /** Output path. Defaults to the host's conventional location. */
  path?: string;
  /** Workflow name shown in the host's UI. Defaults to `"AI Review"`. */
  name?: string;
  /** Per-job timeout in minutes. Defaults to 15. */
  timeoutMinutes?: number;
}

/**
 * A branch or target name safe to interpolate into a generated shell command:
 * letters, digits, and `._/+-`. This forbids whitespace and every shell
 * metacharacter, so a value baked into a `git fetch …` or `./zuke …` line can
 * never broaden into a second command. Matches the characters git permits in a
 * ref name.
 */
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/+-]*$/;

/** Reject a branch/target name that isn't shell-safe, with a friendly error. */
function assertSafeRef(value: string, field: string): void {
  if (!SAFE_REF.test(value)) {
    throw new Error(
      `aiReviewWorkflow: ${field} ${JSON.stringify(value)} is not a valid ` +
        `branch/target name — use only letters, digits, and \`._/+-\` so it ` +
        `is safe to interpolate into the generated command.`,
    );
  }
}

/** Resolve the env var name for a parameter — honours `.env(...)` overrides. */
function envOf(param: AnyParameter): string | undefined {
  if (param.envName_ !== undefined) return param.envName_;
  if (param.name_ === undefined) return undefined; // not yet discovered
  return envVarName(param.name_);
}

/** Each reviewer's effective key env var, plus whether any uses `.comment()`. */
function reviewerEnv(
  reviewers: readonly Reviewer[],
): { keyEnvs: string[]; commentEnvs: string[]; commentEnabled: boolean } {
  const keyEnvs: string[] = [];
  const commentEnvs: string[] = [];
  let commentEnabled = false;
  for (const reviewer of reviewers) {
    const key = reviewer.apiKey_;
    if (typeof key === "object") {
      const name = envOf(key);
      if (name !== undefined && !keyEnvs.includes(name)) keyEnvs.push(name);
    }
    if (reviewer.commentEnabled_) {
      commentEnabled = true;
      const token = reviewer.commentToken_;
      if (typeof token === "object") {
        const name = envOf(token);
        if (name !== undefined && !commentEnvs.includes(name)) {
          commentEnvs.push(name);
        }
      }
    }
  }
  return { keyEnvs, commentEnvs, commentEnabled };
}

/** GitHub-style secret reference, e.g. `${{ secrets.OPENAI_API_KEY }}`. */
function githubRef(name: string): string {
  return `\${{ secrets.${name} }}`;
}

/** Azure-style pipeline-variable reference, e.g. `$(OPENAI_API_KEY)`. */
function azureRef(name: string): string {
  return `$(${name})`;
}

/**
 * A {@link CiFile} subclass for the AI-review workflow. The pipeline is built
 * lazily on every `render()` so that reviewer fields whose parameters were
 * named by `discoverParameters` after construction are still picked up.
 */
class AiReviewWorkflow extends CiFile {
  readonly #spec: AiReviewWorkflowSpec;

  constructor(spec: AiReviewWorkflowSpec) {
    const host = spec.host ?? "github";
    super({ provider: host, path: spec.path ?? DEFAULT_PATHS[host] });
    // Both are interpolated into shell commands in the generated YAML; reject
    // anything that isn't a plain branch/target name up front.
    if (spec.baseBranch !== undefined) {
      assertSafeRef(spec.baseBranch, "baseBranch");
    }
    if (spec.target !== undefined) assertSafeRef(spec.target, "target");
    this.#spec = spec;
  }

  override render(): string {
    return generateCi(this.#pipeline(), this.provider);
  }

  /** Dispatch to the per-host pipeline builder. */
  #pipeline(): CiPipeline {
    switch (this.provider) {
      case "github":
        return this.#github();
      case "gitlab":
        return this.#gitlab();
      case "azure":
        return this.#azure();
      case "bitbucket":
        return this.#bitbucket();
    }
  }

  /** GitHub: a fork-gated PR workflow with harden-runner + pinned checkout. */
  #github(): CiPipeline {
    const baseBranch = this.#spec.baseBranch ?? DEFAULT_BASE_BRANCH;
    const target = this.#spec.target ?? DEFAULT_TARGET;
    const { keyEnvs, commentEnvs, commentEnabled } = reviewerEnv(
      this.#spec.reviewers,
    );
    const env: Record<string, string> = {};
    for (const name of keyEnvs) env[name] = githubRef(name);
    if (commentEnabled) {
      // Default to GITHUB_TOKEN when no explicit comment token was set.
      const tokens = commentEnvs.length > 0 ? commentEnvs : ["GITHUB_TOKEN"];
      for (const name of tokens) env[name] = githubRef(name);
    }
    env.ZUKE_REVIEW_BASE = "FETCH_HEAD";

    const job: CiJob = {
      id: "review",
      name: "AI review",
      runsOn: "ubuntu-latest",
      // Fork PRs must never see the secrets (pwn-request); they also receive
      // no secrets, so the reviewers would skip there anyway.
      if: "${{ github.event.pull_request.head.repo.fork == false }}",
      timeoutMinutes: this.#spec.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
      steps: [
        {
          name: "Harden the runner",
          uses: HARDEN_RUNNER,
          with: { "egress-policy": "audit" },
        },
        { uses: CHECKOUT, with: { "persist-credentials": "false" } },
        {
          name: "Fetch the base branch",
          run: `git fetch --no-tags --depth=1 origin ${baseBranch}`,
        },
        { name: "AI review with Zuke", run: `./zuke ${target}`, env },
      ],
    };
    return {
      name: this.#spec.name ?? DEFAULT_NAME,
      triggers: { pullRequest: [] }, // every branch
      ...(commentEnabled
        ? { permissions: { contents: "read", "pull-requests": "write" } }
        : { permissions: { contents: "read" } }),
      concurrency: {
        group: "ai-review-${{ github.workflow }}-${{ github.ref }}",
        cancelInProgress: true,
      },
      jobs: [job],
    };
  }

  /**
   * GitLab: a merge-request-only job snippet. Variables defined in the
   * project's CI settings flow into the job automatically — the YAML doesn't
   * need an `env:` block. Include from `.gitlab-ci.yml` via
   * `include: { local: '.gitlab/ai-review.gitlab-ci.yml' }`.
   */
  #gitlab(): CiPipeline {
    const target = this.#spec.target ?? DEFAULT_TARGET;
    return {
      name: this.#spec.name ?? DEFAULT_NAME,
      triggers: { pullRequest: [] }, // MR-only via workflow rules
      jobs: [{
        id: "review",
        name: "AI review",
        runsOn: DENO_IMAGE,
        timeoutMinutes: this.#spec.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
        steps: [{ name: "AI review with Zuke", run: `./zuke ${target}` }],
      }],
    };
  }

  /**
   * Bitbucket Pipelines: a `bitbucket-pipelines.yml` whose `pull-requests`
   * section runs the review on the Deno image. Like GitLab, repository and
   * workspace variables flow into the step as env automatically, so no `env:`
   * block is emitted — set the API keys and `BITBUCKET_TOKEN` in repository
   * settings. Bitbucket has no `include`, so this must live at the repo root.
   */
  #bitbucket(): CiPipeline {
    const target = this.#spec.target ?? DEFAULT_TARGET;
    return {
      name: this.#spec.name ?? DEFAULT_NAME,
      triggers: { pullRequest: [] }, // every branch's PRs
      jobs: [{
        id: "review",
        name: "AI review",
        runsOn: DENO_IMAGE, // the official Deno image works on Bitbucket too
        timeoutMinutes: this.#spec.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
        steps: [{ name: "AI review with Zuke", run: `./zuke ${target}` }],
      }],
    };
  }

  /**
   * Azure Pipelines: a PR-only job snippet. Pipeline secrets are NOT exposed
   * as env vars by default, so each reviewer's key env var is wired into the
   * script step's `env:` block as `$(NAME)`. Use as a template from your main
   * pipeline.
   */
  #azure(): CiPipeline {
    const target = this.#spec.target ?? DEFAULT_TARGET;
    const { keyEnvs, commentEnvs, commentEnabled } = reviewerEnv(
      this.#spec.reviewers,
    );
    const env: Record<string, string> = {};
    for (const name of keyEnvs) env[name] = azureRef(name);
    if (commentEnabled) {
      // Default to SYSTEM_ACCESSTOKEN when no explicit comment token was set.
      const tokens = commentEnvs.length > 0
        ? commentEnvs
        : ["SYSTEM_ACCESSTOKEN"];
      for (const name of tokens) env[name] = azureRef(name);
    }
    return {
      name: this.#spec.name ?? DEFAULT_NAME,
      triggers: { pullRequest: [] }, // every branch
      jobs: [{
        id: "review",
        name: "AI review",
        runsOn: "ubuntu-latest",
        timeoutMinutes: this.#spec.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
        steps: [{ name: "AI review with Zuke", run: `./zuke ${target}`, env }],
      }],
    };
  }
}

/**
 * Declare a generated AI-review workflow on the build. The returned
 * {@link CiFile} is automatically discovered by `discoverCiFiles` and kept on
 * disk by `syncCiFiles`. Default `host: "github"`; pass `"gitlab"` or
 * `"azure"` to target those hosts.
 *
 * ```ts
 * class Pipeline extends Build {
 *   openaiKey = parameter("OpenAI key").secret().env("OPENAI_API_KEY");
 *   review = securityReviewer((r) =>
 *     r.provider("openai").apiKey(this.openaiKey).comment()
 *   );
 *   reviewTarget = target().validateBefore(this.review).executes(() => {});
 *   ghWorkflow = aiReviewWorkflow({ reviewers: [this.review] });
 *   glWorkflow = aiReviewWorkflow({ host: "gitlab", reviewers: [this.review] });
 * }
 * ```
 */
export function aiReviewWorkflow(spec: AiReviewWorkflowSpec): CiFile {
  return new AiReviewWorkflow(spec);
}
