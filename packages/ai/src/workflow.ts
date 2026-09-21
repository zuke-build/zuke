// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
 *     With a {@link AiReviewWorkflowSpec.command}, a second job runs the same
 *     target on demand when a maintainer comments the command on any pull
 *     request, fork or not — from the default branch's checkout, with the pull
 *     request fetched as data (see {@link ReviewCommandSettings}). When any
 *     reviewer anchors findings to review threads, a third job runs the same
 *     target when a maintainer **replies in a review thread**, so a rebuttal
 *     gets its answer without a push (see {@link REPLY_JOB}).
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

import type { Configure } from "@zuke/core/tooling";
import {
  type AnyParameter,
  CiFile,
  type CiJob,
  type CiPinResolver,
  type CiPipeline,
  type CiProvider,
  envVarName,
  generateCi,
  ZUKE_ACTION,
} from "@zuke/core";
import { REVIEW_PR_ENV } from "./diff.ts";
import type { Reviewer } from "./reviewer.ts";
import { FINDING_MARKER_PREFIX } from "./threads.ts";

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

/**
 * A comment command safe to quote inside the generated `if:` expression: words
 * of letters, digits and `@/_.:-`, separated by single spaces — enough for
 * `@zuke-build review` or `/zuke review`, and nothing that could close the
 * quote the expression wraps it in.
 */
const SAFE_COMMAND = /^[A-Za-z0-9@/][A-Za-z0-9@/_.:-]*( [A-Za-z0-9@/_.:-]+)*$/;

/**
 * The env var the command job sets to the id of the comment that started it,
 * for a build that wants to acknowledge the command (react on it, say) before
 * the review runs. The pull request itself travels as {@link REVIEW_PR_ENV}.
 */
const REVIEW_COMMENT_ENV = "ZUKE_REVIEW_COMMENT";

/**
 * The command job's first step after the checkout: refuse to run the review
 * unless the commenter has push access. `author_association` — all the gate's
 * `if:` can see — says only that someone is an organisation member or a
 * collaborator, and both include read-only accounts. The collaborators API
 * says what they may actually do, so the job asks it before spending a key:
 * `admin` and `write` (which `maintain` reports as) pass; `read` (which
 * `triage` reports as) and `none` fail the job with the reason, and so does
 * an answer that cannot be read at all — the step fails closed. The login
 * reaches the script as env, never interpolated, and is checked against the
 * characters a GitHub login can contain before it is put in a URL.
 *
 * `onDenied` is what a commenter without push access gets. The command job
 * fails the step: a maintainer typed a command and should see why it did not
 * run. The reply job records `push=false` in the step's outputs and ends
 * succeeded: a reply in a review thread is ordinary conversation, and a red
 * check for every non-pusher who joins one would be noise, and a lever anyone
 * could pull. An answer that cannot be read fails closed in both.
 */
function pushAccessScript(onDenied: "fail" | "skip"): string {
  return [
    // Fail closed, explicitly: a failed API call, an unset variable, or a
    // broken pipe stops the step, whatever shell flags the runner defaults to.
    "set -euo pipefail",
    'case "$ZUKE_REVIEW_ACTOR" in',
    '  ""|*[!A-Za-z0-9-]*)',
    '    echo "::error::the commenter\'s login is not a GitHub login"',
    "    exit 1 ;;",
    "esac",
    'permission="$(gh api "repos/$GITHUB_REPOSITORY/collaborators/$ZUKE_REVIEW_ACTOR/permission" --jq .permission)" || {',
    '  echo "::error::could not read $ZUKE_REVIEW_ACTOR\'s permission on $GITHUB_REPOSITORY; refusing to run the review"',
    "  exit 1",
    "}",
    'case "$permission" in',
    "  admin|write)",
    '    echo "$ZUKE_REVIEW_ACTOR has $permission access."',
    '    echo "push=true" >> "$GITHUB_OUTPUT" ;;',
    "  *)",
    ...(onDenied === "fail"
      ? [
        '    echo "::error::$ZUKE_REVIEW_ACTOR has $permission access to $GITHUB_REPOSITORY; starting a review needs push access."',
        "    exit 1 ;;",
      ]
      : [
        '    echo "$ZUKE_REVIEW_ACTOR has $permission access to $GITHUB_REPOSITORY; starting a review needs push access."',
        '    echo "push=false" >> "$GITHUB_OUTPUT" ;;',
      ]),
    "esac",
  ].join("\n");
}

/** The step id the push-access check publishes its verdict under. */
const PUSH_STEP_ID = "push";

/**
 * The clause that keeps a fork's code away from the secrets: the head
 * repository is this repository. Stated as a name comparison rather than
 * `head.repo.fork == false`, because a fork that was deleted after the pull
 * request was opened leaves `head.repo` null, and the expression language's
 * loose comparison reads `null == false` as true — a gate that would open for
 * exactly the pull request nobody can inspect any more. A null name compares
 * unequal, so this fails closed.
 */
const SAME_REPO =
  "github.event.pull_request.head.repo.full_name == github.repository";

/**
 * The job that answers a rebuttal without a push. It runs on
 * `pull_request_review_comment`, which — unlike `issue_comment` — checks out the
 * pull request's merge ref exactly as `pull_request` does, so it is the
 * `pull_request` job's steps behind a different gate: the comment is a
 * **reply** in a thread (a fresh line comment starts nothing), by a human
 * account, on a pull request from this repository ({@link SAME_REPO} — the
 * review job's rule, for the same reason), and — before any key is spent — by
 * someone the collaborators API says has push access, the command job's step
 * in its skipping mode. The event's own `author_association` is deliberately
 * not in the gate: on this event GitHub reports an organisation member as
 * `CONTRIBUTOR` (observed on this repository's own pull requests), so a gate
 * on it turned real maintainers away while admitting nobody the API check
 * would not. The gate cannot see whose thread the reply is in either, so a
 * further step reads the thread's root and lets the review run only when it
 * is a Zuke finding thread ({@link REPLY_THREAD_STEP}).
 *
 * One thing neither can see: the reviewer's own outcome replies are told apart
 * only by account type. Posted with the workflow's token or an App they are
 * bot-authored and start nothing; a personal token makes them a maintainer's
 * comments, and each reply-posting run is then followed by one more.
 *
 * Emitted only when a reviewer uses `.discussion((d) => d.threads())`: without
 * threads there is no reply to listen for, and a maintainer contests a finding
 * by quoting its id, which the next push or the command picks up.
 */
const REPLY_JOB = "replyReview";

/**
 * The reply job's step after the push-access check: read the comment the reply
 * answers — GitHub's `in_reply_to_id` is always the thread's root, never an
 * intermediate reply — and let the review run only when that root opens with
 * a Zuke finding marker. The job's `if:` cannot see the root at all, so without
 * this every maintainer reply in every review thread on the pull request would
 * spend a review; with it, a reply anywhere else ends the job here, succeeded,
 * having done nothing. The id reaches the script as env, never interpolated,
 * and is checked to be a number before it is put in a URL; an answer that
 * cannot be read fails closed, like the push-access step.
 */
const REPLY_THREAD_STEP = [
  "set -euo pipefail",
  'case "$ZUKE_REVIEW_PARENT" in',
  '  ""|*[!0-9]*)',
  '    echo "::error::the reply\'s parent comment id is not a number"',
  "    exit 1 ;;",
  "esac",
  'root="$(gh api "repos/$GITHUB_REPOSITORY/pulls/comments/$ZUKE_REVIEW_PARENT" --jq .body)" || {',
  '  echo "::error::could not read the comment the reply answers; refusing to run the review"',
  "  exit 1",
  "}",
  'case "$root" in',
  `  "${FINDING_MARKER_PREFIX}"*)`,
  '    echo "The reply is in a Zuke review thread."',
  '    echo "review=true" >> "$GITHUB_OUTPUT" ;;',
  "  *)",
  '    echo "The reply is not in a Zuke review thread; nothing to review."',
  '    echo "review=false" >> "$GITHUB_OUTPUT" ;;',
  "esac",
].join("\n");

/** The step id the reply job's later steps read their go-ahead from. */
const REPLY_THREAD_STEP_ID = "thread";

/** A secret name as GitHub Actions accepts it in `${{ secrets.NAME }}`. */
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The `author_association` values a comment must carry to start the review:
 * the repository's owner, an organisation member, or a direct collaborator —
 * the same set the discussion feature trusts. `CONTRIBUTOR` is deliberately
 * absent: anyone with one merged pull request has it.
 */
const COMMAND_AUTHORS = ["OWNER", "MEMBER", "COLLABORATOR"];

/**
 * The comment command that runs the review on demand, configured through
 * {@link AiReviewWorkflowSpec.command}.
 *
 * The job it adds runs on `issue_comment`, which GitHub delivers for comments on
 * pull requests too, always from the **default branch** and always with the
 * repository's secrets — so its `if:` is the whole access control. It fires only
 * when the comment is on a pull request, starts with {@link text}, was written
 * by a human (not a bot account), and its author's `author_association` is
 * `OWNER`, `MEMBER` or `COLLABORATOR`. The comment body is matched in the
 * expression and never interpolated into a `run:` line. Then, before the
 * review runs, the job asks the collaborators API whether the commenter has
 * push access, and stops if not — an association alone admits read-only
 * members and collaborators.
 *
 * What runs is the default branch's build, never the pull request's: the job
 * passes `ZUKE_REVIEW_PR`, and the reviewers fetch that pull request's merge
 * as data and diff it. That is what makes the flow safe for a fork — the code
 * under review is read, not executed — and it is why a pull request cannot
 * change the rules it is judged by from this flow: its `zuke.ts`, suppressions
 * and criteria never load. The maintainer's comment is the human gate, as it
 * is for Dependabot's `@dependabot` commands.
 */
export class ReviewCommandSettings {
  /** The command a comment must start with. Set by {@link text}. */
  text_?: string;
  /**
   * Secrets the command job's review step receives beyond the reviewers' own
   * keys and the host token. Set by {@link secrets}.
   */
  secrets_: string[] = [];

  /**
   * The command, e.g. `"@zuke-build review"`. Matched case-insensitively at
   * the start of the comment, so a reply that quotes it (`> @zuke-build
   * review`) does not start a run. Letters, digits, `@/_.:-` and single spaces
   * only.
   */
  text(command: string): this {
    this.text_ = command;
    return this;
  }

  /**
   * Pass these repository secrets to the command job's review step as env vars
   * of the same name — e.g. the GitHub App credentials the build mints its
   * `commentToken` from, so the review posts as the app. Only the command job
   * receives them; the `pull_request` job is unchanged.
   */
  secrets(...names: string[]): this {
    this.secrets_.push(...names);
    return this;
  }
}

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
  /**
   * Emit the `git fetch` step that makes the base branch available, and point
   * the reviewers at what it fetched. Defaults to `true`, because a pull-request
   * checkout is shallow and has no base to diff against.
   *
   * Set it to `false` when the build's review target fetches its own base — then
   * the workflow drops the step, and the reviewers use their own configured base
   * rather than the fetched `FETCH_HEAD`. Preferable where it applies: the same
   * `zuke review` then works locally, where no workflow step exists to run.
   */
  fetchBase?: boolean;
  /**
   * The pinned `step-security/harden-runner@<sha>` to harden the runner with.
   *
   * Supplying this — or {@link checkout} — renders the two separate steps
   * instead of the prelude action, because naming an action means those
   * specific actions were asked for. Leave both unset for the default, which
   * is the one action that does both and carries its own pin.
   */
  hardenRunner?: string;
  /**
   * The pinned `actions/checkout@<sha>` to check the repository out with.
   * Like {@link hardenRunner}, supplying it renders the separate steps.
   */
  checkout?: string;
  /**
   * Resolves each action's pinned reference by name, exactly as `cicd`'s own
   * option does.
   *
   * Supply it when the build sources pins from somewhere that stays current.
   * Without it the prelude action falls back to the reference baked into the
   * core this package resolved against — which is a release behind as soon as
   * the action is released again, and silently so: this file would name a
   * different commit from every other generated workflow in the repository,
   * and only a diff would show it.
   */
  pins?: CiPinResolver;
  /** Output path. Defaults to the host's conventional location. */
  path?: string;
  /** Workflow name shown in the host's UI. Defaults to `"AI Review"`. */
  name?: string;
  /** Per-job timeout in minutes. Defaults to 15. */
  timeoutMinutes?: number;
  /**
   * Run the review on demand when a maintainer comments a command on a pull
   * request — any pull request, a fork's included. GitHub only; see
   * {@link ReviewCommandSettings} for the job it adds and the gate it runs
   * behind.
   *
   * ```ts
   * aiReviewWorkflow({
   *   reviewers: [this.security],
   *   command: (c) =>
   *     c.text("@zuke-build review")
   *       .secrets("ZUKE_BUILD_APP_ID", "ZUKE_BUILD_APP_KEY"),
   * });
   * ```
   */
  command?: Configure<ReviewCommandSettings>;
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

/** A resolved {@link ReviewCommandSettings}: the command text, and its secrets. */
interface ReviewCommand {
  /** The command a comment must start with. */
  readonly text: string;
  /** The secrets the command job's review step receives. */
  readonly secrets: readonly string[];
}

/**
 * Resolve the command settings, rejecting a command that could break out of
 * the expression it is quoted in, and a secret name Actions would not accept.
 */
function resolveCommand(
  configure: Configure<ReviewCommandSettings>,
): ReviewCommand {
  const command = configure(new ReviewCommandSettings());
  const text = command.text_;
  if (text === undefined || !SAFE_COMMAND.test(text)) {
    throw new Error(
      `aiReviewWorkflow: command ${JSON.stringify(text)} is not a valid ` +
        `comment command — use words of letters, digits and \`@/_.:-\` ` +
        `separated by single spaces, e.g. "@zuke-build review".`,
    );
  }
  for (const name of command.secrets_) {
    if (!SECRET_NAME.test(name)) {
      throw new Error(
        `aiReviewWorkflow: secret ${JSON.stringify(name)} is not a valid ` +
          `secret name — letters, digits and underscores only.`,
      );
    }
  }
  return { text, secrets: command.secrets_ };
}

/** Resolve the env var name for a parameter — honours `.env(...)` overrides. */
function envOf(param: AnyParameter): string | undefined {
  if (param.envName_ !== undefined) return param.envName_;
  if (param.name_ === undefined) return undefined; // not yet discovered
  return envVarName(param.name_);
}

/**
 * Each reviewer's effective key env var, plus whether any uses `.comment()`
 * and whether any anchors findings to review threads.
 */
function reviewerEnv(
  reviewers: readonly Reviewer[],
): {
  keyEnvs: string[];
  commentEnvs: string[];
  commentEnabled: boolean;
  threadsEnabled: boolean;
} {
  const keyEnvs: string[] = [];
  const commentEnvs: string[] = [];
  let commentEnabled = false;
  let threadsEnabled = false;
  for (const reviewer of reviewers) {
    if (reviewer.threadsEnabled_) threadsEnabled = true;
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
  return { keyEnvs, commentEnvs, commentEnabled, threadsEnabled };
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
  /** The resolved comment command, when the spec declares one. */
  readonly #command?: ReviewCommand;

  constructor(spec: AiReviewWorkflowSpec) {
    const host = spec.host ?? "github";
    super({
      provider: host,
      path: spec.path ?? DEFAULT_PATHS[host],
      pins: spec.pins,
    });
    // Both are interpolated into shell commands in the generated YAML; reject
    // anything that isn't a plain branch/target name up front.
    if (spec.baseBranch !== undefined) {
      assertSafeRef(spec.baseBranch, "baseBranch");
    }
    if (spec.target !== undefined) assertSafeRef(spec.target, "target");
    if (spec.command !== undefined) {
      this.#command = resolveCommand(spec.command);
    }
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

  /**
   * The script step's `env:` block for a host whose secrets are not ambient:
   * every reviewer's API-key secret, plus the comment token — `defaultToken`
   * when no reviewer named one explicitly. `ref` renders one secret reference in
   * the host's own syntax ({@link githubRef}, {@link azureRef}), which is the
   * only thing that differs between the two hosts needing the block at all.
   */
  #secretEnv(
    reviewers: ReturnType<typeof reviewerEnv>,
    ref: (name: string) => string,
    defaultToken: string,
  ): Record<string, string> {
    const env: Record<string, string> = {};
    for (const name of reviewers.keyEnvs) env[name] = ref(name);
    if (reviewers.commentEnabled) {
      const tokens = reviewers.commentEnvs.length > 0
        ? reviewers.commentEnvs
        : [defaultToken];
      for (const name of tokens) env[name] = ref(name);
    }
    return env;
  }

  /**
   * One GitHub job of this workflow: the prelude core renders, a job-level
   * timeout and concurrency group, the `if:` that gates it, and
   * `pull-requests: write` when the reviewers comment — the two jobs differ
   * only in their gate, their steps, and where the pull request's number is
   * in the event.
   */
  #githubJob(
    id: string,
    name: string,
    gate: string,
    steps: CiJob["steps"],
    comments: boolean,
    pull: string,
    cancelInProgress: boolean,
  ): CiJob {
    return {
      id,
      name,
      runsOn: "ubuntu-latest",
      if: `\${{ ${gate} }}`,
      // One run per pull request, shared by every job of this workflow and
      // declared on the job, not the workflow. Keyed on the pull request
      // rather than `github.ref`, which is the default branch for every
      // comment-started run. On the job because a skipped job never enters
      // its group, whereas a run whose jobs are all skipped still enters a
      // workflow-level one: the review's own comment, posted as an app, fires
      // `issue_comment` again, and that run — skipped by the bot check — would
      // otherwise cancel the review still posting it.
      //
      // Shared across the jobs because every run of the target reads the
      // state block from the reviewer's comment and writes it back; two runs
      // in flight at once each write the state they started from, and the
      // later post silently drops whatever the earlier run recorded. That
      // happened: a push run and a reply run overlapped, and the findings the
      // push run had just opened vanished from the state the reply run wrote
      // back, leaving their threads unanswerable. Only the push run cancels
      // what is in flight — a superseded head is not worth finishing, and a
      // reply or command run reads the same threads on the new head — while
      // a reply or command run queues behind whatever is running and starts
      // from the state it posted.
      concurrency: {
        group: `ai-review-\${{ github.workflow }}-\${{ ${pull} }}`,
        cancelInProgress,
      },
      // The write scope sits on the job that posts, not on the workflow: with
      // two jobs, a workflow-level write is broader than either needs, and
      // zizmor's excessive-permissions audit says so.
      ...(comments
        ? { permissions: { contents: "read", "pull-requests": "write" } }
        : {}),
      timeoutMinutes: this.#spec.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
      // Declared rather than built here, so the prelude is whatever core
      // renders for one — today a single `zuke-build/zuke` step that hardens
      // and checks out. Naming either action opts back out to the two separate
      // steps, which is what `hardenRunner` and `checkout` configure.
      //
      // This retires the trap this file used to carry. Its two SHAs were
      // constants inside a published package, so a generated workflow's pins
      // came from a release rather than from the file a bot edits: Dependabot
      // bumped ai-review.yml, the next regeneration wrote the stale constant
      // back, and the bump was silently reverted. That happened, and the
      // constant had to be hand-updated to match.
      harden: { egress: "audit", action: this.#spec.hardenRunner },
      checkout: { persistCredentials: false, action: this.#spec.checkout },
      // Resolved here rather than left to core, whose fallback is the reference
      // baked into the release this package resolved against — a release behind
      // as soon as the action is released again, and silently so: this file
      // would name a different commit from every other generated workflow, and
      // only a diff would show it.
      // Left alone when either action is named, so core applies its own rule:
      // naming one means those specific actions were asked for, and the prelude
      // that runs neither would discard a pin the caller chose.
      bootstrap: this.#spec.hardenRunner === undefined &&
          this.#spec.checkout === undefined
        ? { action: this.#spec.pins?.(ZUKE_ACTION) }
        : undefined,
      steps,
    };
  }

  /**
   * The gate of the command job — the whole access control of a job that runs
   * on the default branch with the repository's secrets. Every clause reads
   * metadata GitHub asserts, never the comment's text beyond its prefix: the
   * comment is on a pull request, its author is a human account whose
   * association is one of {@link COMMAND_AUTHORS}, and the body starts with
   * the command. The bot check is what stops the review's own comments,
   * posted with an app token (which, unlike `GITHUB_TOKEN`, does trigger
   * workflows), from starting another run.
   */
  static #commandGate(text: string): string {
    const author = "github.event.comment.author_association";
    const trusted = COMMAND_AUTHORS.map((a) => `${author} == '${a}'`).join(
      " || ",
    );
    return [
      "github.event_name == 'issue_comment'",
      "github.event.issue.pull_request",
      "github.event.comment.user.type != 'Bot'",
      `(${trusted})`,
      `startsWith(github.event.comment.body, '${text}')`,
    ].join(" && ");
  }

  /**
   * The gate of the reply job — see {@link REPLY_JOB}. The repository clause
   * is the `pull_request` job's: this event checks the pull request out, so a
   * fork's code must never run with the secrets.
   */
  static #replyGate(): string {
    return [
      "github.event_name == 'pull_request_review_comment'",
      SAME_REPO,
      "github.event.comment.in_reply_to_id",
      "github.event.comment.user.type != 'Bot'",
    ].join(" && ");
  }

  /** The reply job's thread check — see {@link REPLY_THREAD_STEP}. */
  static #replyThreadStep(): NonNullable<CiJob["steps"]>[number] {
    return {
      id: REPLY_THREAD_STEP_ID,
      name: "Require the reply to be in a Zuke review thread",
      shell: "bash",
      run: REPLY_THREAD_STEP,
      env: {
        GH_TOKEN: "${{ github.token }}",
        ZUKE_REVIEW_PARENT: "${{ github.event.comment.in_reply_to_id }}",
      },
    };
  }

  /**
   * The push-access check, first step of both comment-started jobs — see
   * {@link pushAccessScript} for what `onDenied` decides.
   */
  static #pushAccessStep(
    onDenied: "fail" | "skip",
  ): NonNullable<CiJob["steps"]>[number] {
    return {
      id: PUSH_STEP_ID,
      name: "Require push access for the commenter",
      shell: "bash",
      run: pushAccessScript(onDenied),
      env: {
        GH_TOKEN: "${{ github.token }}",
        ZUKE_REVIEW_ACTOR: "${{ github.event.comment.user.login }}",
      },
    };
  }

  /**
   * GitHub: a fork-gated PR workflow with harden-runner + pinned checkout —
   * plus, with a command, the on-demand job it starts, and, with review
   * threads, the job a maintainer's reply starts.
   */
  #github(): CiPipeline {
    const baseBranch = this.#spec.baseBranch ?? DEFAULT_BASE_BRANCH;
    const target = this.#spec.target ?? DEFAULT_TARGET;
    const reviewers = reviewerEnv(this.#spec.reviewers);
    const env = this.#secretEnv(reviewers, githubRef, "GITHUB_TOKEN");
    // Only when this workflow is the thing that fetched the base: pointing the
    // reviewers at FETCH_HEAD would otherwise override a base the build resolves
    // for itself.
    const fetchBase = this.#spec.fetchBase ?? true;
    const reviewEnv = fetchBase
      ? { ...env, ZUKE_REVIEW_BASE: "FETCH_HEAD" }
      : env;

    // Fork PRs must never see the secrets (pwn-request); they also receive
    // no secrets, so the reviewers would skip there anyway. The event check
    // matters once the command job shares the workflow: a comment event has
    // no `pull_request` payload, and a missing field compares as `false`
    // would — so it is stated rather than relied on.
    const reviewSteps: CiJob["steps"] = [
      ...(fetchBase
        ? [{
          name: "Fetch the base branch",
          run: `git fetch --no-tags --depth=1 origin ${baseBranch}`,
        }]
        : []),
      {
        name: "AI review with Zuke",
        run: `./zuke ${target}`,
        env: reviewEnv,
      },
    ];
    const review = this.#githubJob(
      "review",
      "AI review",
      `github.event_name == 'pull_request' && ${SAME_REPO}`,
      reviewSteps,
      reviewers.commentEnabled,
      "github.event.pull_request.number",
      true,
    );
    const jobs = [review];
    if (reviewers.threadsEnabled) {
      // The same steps as the review job — this event checks the pull request
      // out too — behind the reply gate, the push-access check, and the thread
      // check whose go-ahead every later step waits for.
      jobs.push(this.#githubJob(
        REPLY_JOB,
        "AI review on thread reply",
        AiReviewWorkflow.#replyGate(),
        [
          AiReviewWorkflow.#pushAccessStep("skip"),
          {
            ...AiReviewWorkflow.#replyThreadStep(),
            if: `steps.${PUSH_STEP_ID}.outputs.push == 'true'`,
          },
          ...reviewSteps.map((step) => ({
            ...step,
            if: `steps.${PUSH_STEP_ID}.outputs.push == 'true' && ` +
              `steps.${REPLY_THREAD_STEP_ID}.outputs.review == 'true'`,
          })),
        ],
        reviewers.commentEnabled,
        "github.event.pull_request.number",
        false,
      ));
    }
    const command = this.#command;
    if (command !== undefined) {
      // No base fetch and no `ZUKE_REVIEW_BASE`: the reviewers fetch the pull
      // request `ZUKE_REVIEW_PR` names and diff its merge against the base it
      // was merged onto, which needs nothing from the checkout but a remote.
      const commandEnv: Record<string, string> = { ...env };
      for (const name of command.secrets) commandEnv[name] = githubRef(name);
      commandEnv[REVIEW_PR_ENV] = "${{ github.event.issue.number }}";
      commandEnv[REVIEW_COMMENT_ENV] = "${{ github.event.comment.id }}";
      jobs.push(this.#githubJob(
        "commandReview",
        "AI review on command",
        AiReviewWorkflow.#commandGate(command.text),
        [
          AiReviewWorkflow.#pushAccessStep("fail"),
          {
            name: "AI review with Zuke",
            run: `./zuke ${target}`,
            env: commandEnv,
          },
        ],
        reviewers.commentEnabled,
        "github.event.issue.number",
        false,
      ));
    }
    return {
      name: this.#spec.name ?? DEFAULT_NAME,
      triggers: {
        pullRequest: [], // every branch
        ...(reviewers.threadsEnabled
          ? { pullRequestReviewComment: ["created"] }
          : {}),
        ...(command !== undefined ? { issueComment: ["created"] } : {}),
      },
      permissions: { contents: "read" },
      // No workflow-level concurrency: each job carries its own, see
      // `#githubJob` for why.
      jobs,
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
    const env = this.#secretEnv(
      reviewerEnv(this.#spec.reviewers),
      azureRef,
      "SYSTEM_ACCESSTOKEN",
    );
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
