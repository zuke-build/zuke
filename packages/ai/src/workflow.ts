/**
 * Generate the AI-review CI workflow from declared {@link Reviewer}s. Returns a
 * [`CiFile`](jsr:@zuke/core) — so the standard `cicd` plumbing
 * (`discoverCiFiles`/`syncCiFiles`) keeps it on disk in sync with the build
 * definition, the same way every other generated workflow works.
 *
 * The workflow runs on every pull request, non-fork-only (the secrets must
 * never reach untrusted code), with a pinned harden-runner + checkout + a
 * `./zuke <target>` step that gets every reviewer's secret env var wired up.
 * If any reviewer has `.comment()` enabled, the workflow gains
 * `pull-requests: write` and passes `GITHUB_TOKEN`.
 *
 * @module
 */

import {
  type AnyParameter,
  CiFile,
  type CiPipeline,
  envVarName,
  generateCi,
} from "@zuke/core";
import type { Reviewer } from "./reviewer.ts";

/** SHA-pinned `step-security/harden-runner` (v2.19.4). */
const HARDEN_RUNNER =
  "step-security/harden-runner@9af89fc71515a100421586dfdb3dc9c984fbf411";

/** SHA-pinned `actions/checkout` (v6.0.3). */
const CHECKOUT = "actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10";

/** The default output path on GitHub. */
const DEFAULT_PATH = ".github/workflows/ai-review.yml";

/** The conventional name shown in the Actions UI. */
const DEFAULT_NAME = "AI Review";

/** The default base branch to diff against (FETCH_HEAD after the fetch step). */
const DEFAULT_BASE_BRANCH = "master";

/** The default build target the workflow runs (`./zuke <target>`). */
const DEFAULT_TARGET = "review";

/** Per-job time cap (matches the original hand-written workflow). */
const DEFAULT_TIMEOUT_MINUTES = 15;

/** What to generate — only `reviewers` is required. */
export interface AiReviewWorkflowSpec {
  /**
   * The reviewers whose key env vars and `.comment()` setting drive the
   * generated workflow. Each reviewer's `.apiKey(param)` parameter becomes an
   * `env:` entry that maps the secret in; any reviewer with `.comment()`
   * causes the workflow to grant `pull-requests: write` and pass
   * `GITHUB_TOKEN`.
   */
  reviewers: readonly Reviewer[];
  /** The build target the workflow runs. Defaults to `"review"`. */
  target?: string;
  /**
   * The base branch the diff is taken against, fetched into `FETCH_HEAD`.
   * Defaults to `"master"`.
   */
  baseBranch?: string;
  /** Output path. Defaults to `.github/workflows/ai-review.yml`. */
  path?: string;
  /** Workflow name shown in the Actions UI. Defaults to `"AI Review"`. */
  name?: string;
  /** Per-job timeout in minutes. Defaults to 15. */
  timeoutMinutes?: number;
}

/** Resolve the env var name for a parameter — honours `.env(...)` overrides. */
function envOf(param: AnyParameter): string | undefined {
  if (param.envName_ !== undefined) return param.envName_;
  if (param.name_ === undefined) return undefined; // not yet discovered
  return envVarName(param.name_);
}

/**
 * A {@link CiFile} subclass for the AI-review workflow. The pipeline is built
 * lazily on every `render()` so that reviewer fields whose parameters were
 * named by `discoverParameters` after construction are still picked up.
 */
class AiReviewWorkflow extends CiFile {
  readonly #spec: AiReviewWorkflowSpec;

  constructor(spec: AiReviewWorkflowSpec) {
    super({ provider: "github", path: spec.path ?? DEFAULT_PATH });
    this.#spec = spec;
  }

  override render(): string {
    return generateCi(this.#pipeline(), this.provider);
  }

  /** Build the pipeline fresh — see the class JSDoc for the deferred-render rationale. */
  #pipeline(): CiPipeline {
    const baseBranch = this.#spec.baseBranch ?? DEFAULT_BASE_BRANCH;
    const target = this.#spec.target ?? DEFAULT_TARGET;
    const env: Record<string, string> = {};
    let needsPrWrite = false;
    for (const reviewer of this.#spec.reviewers) {
      const key = reviewer.apiKey_;
      if (typeof key === "object") {
        const name = envOf(key);
        if (name !== undefined) {
          env[name] = `\${{ secrets.${name} }}`;
        }
      }
      if (reviewer.commentEnabled_) {
        needsPrWrite = true;
        const token = reviewer.commentToken_;
        if (token === undefined) {
          env.GITHUB_TOKEN = "${{ secrets.GITHUB_TOKEN }}";
        } else if (typeof token === "object") {
          const name = envOf(token);
          if (name !== undefined) {
            env[name] = `\${{ secrets.${name} }}`;
          }
        }
      }
    }
    env.ZUKE_REVIEW_BASE = "FETCH_HEAD";

    return {
      name: this.#spec.name ?? DEFAULT_NAME,
      triggers: { pullRequest: [] }, // every branch
      ...(needsPrWrite
        ? { permissions: { contents: "read", "pull-requests": "write" } }
        : { permissions: { contents: "read" } }),
      concurrency: {
        group: "ai-review-${{ github.workflow }}-${{ github.ref }}",
        cancelInProgress: true,
      },
      jobs: [{
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
      }],
    };
  }
}

/**
 * Declare a generated AI-review workflow on the build. The returned
 * {@link CiFile} is automatically discovered by `discoverCiFiles` and kept on
 * disk by `syncCiFiles`, so the committed `.github/workflows/ai-review.yml` is
 * always in sync with the reviewers declared in the build.
 *
 * ```ts
 * class Pipeline extends Build {
 *   openaiKey = parameter("OpenAI key").secret().env("OPENAI_API_KEY");
 *   review = securityReviewer((r) =>
 *     r.provider("openai").apiKey(this.openaiKey).comment()
 *   );
 *   reviewTarget = target().validateBefore(this.review).executes(() => {});
 *   aiReviewWorkflow = aiReviewWorkflow({
 *     reviewers: [this.review], target: "reviewTarget"
 *   });
 * }
 * ```
 */
export function aiReviewWorkflow(spec: AiReviewWorkflowSpec): CiFile {
  return new AiReviewWorkflow(spec);
}
