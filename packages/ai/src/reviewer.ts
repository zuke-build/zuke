// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The fluent {@link Reviewer} and its per-assessment factory functions — the
 * orchestration that ties the diff source, provider, parser, and gate together
 * behind the {@link Validation} contract.
 *
 * @module
 */

import {
  type AnyParameter,
  sha256Hex,
  type Validation,
  type ValidationContext,
} from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { Command } from "@zuke/core/shell";
import type {
  Assessment,
  AssessmentFinding,
  AssessmentType,
  Effort,
  Provider,
  Severity,
  Usage,
} from "./types.ts";
import { AiReviewError } from "./errors.ts";
import {
  DEFAULT_EXCLUDES,
  DiffSettings,
  fetchBaseDiff,
  fetchPullRequestDiff,
  filterDiff,
  truncate,
} from "./diff.ts";
import {
  describeGate,
  type GateRule,
  GateSettings,
  gateTrips,
} from "./gate.ts";
import {
  buildAdjudicatePrompt,
  buildDedupPrompt,
  buildPrompt,
  buildVerifyPrompt,
} from "./prompt.ts";
import { callProvider, DEFAULT_MODELS, resolveKey } from "./provider.ts";
import { type BudgetExhausted, cachedCall, type CachedResult } from "./call.ts";
import { emptyAssessment, parseAssessment } from "./assessment.ts";
import {
  consoleLines,
  type DismissedFinding,
  type RefutedFinding,
  type ReportExtras,
  retryLine,
  reviewStartLine,
  skipConsoleLine,
  skipMarkdown,
  toMarkdown,
  writeStepSummary,
} from "./report.ts";
import { detectReviewHost, type EnvReader, readEnv } from "./hosts.ts";
import { commentMarker, type HostComment } from "./hosts/types.ts";
import type { RetryInfo, RetryOptions } from "./retry.ts";
import type { Budget } from "./budget.ts";
import type { AiCache } from "./cache.ts";
import { findingFingerprint, type Suppressions } from "./suppress.ts";
import { rank, severityScore } from "./severity.ts";
import {
  budgetComments,
  DiscussionSettings,
  rebuttalsFor,
  trustedComments,
} from "./discussion.ts";
import {
  aliasIndex,
  decodeState,
  dismissedOf,
  encodeState,
  fixedOf,
  mergeAliases,
  openOf,
  refutedOf,
  type ReviewState,
  type StoredFinding,
} from "./state.ts";
import {
  adoptCanonicalIds,
  type Adoption,
  DEDUP_VERDICTS,
  dedupCapNote,
  dedupNotes,
  eligible,
  planDedup,
  type RewordResult,
  sameAs,
} from "./dedup.ts";
import { parseVerdicts, type Verdict } from "./verdicts.ts";
import { verdictsGeminiSchema, verdictsJsonSchema } from "./schema.ts";
import { anchorableLines, changedPaths } from "./diff.ts";
import { allReplies, withThreadRebuttals } from "./threads.ts";
import {
  postThreads,
  prepareThreads,
  type ThreadContext,
  type ThreadPhaseSettings,
} from "./threads_phase.ts";
import { buildFileContext } from "./file_context.ts";
import { readTextOrUndefined } from "./context.ts";
import type { PromptExtras, RebuttalNote } from "./prompts/templates.ts";
import { rebuttalComment } from "./prompts/templates.ts";
import type { Redact } from "./comment.ts";

/**
 * Where a reviewer's comment-posting token comes from: a secret parameter (for
 * its env var), a literal, or a function that produces the token when a post
 * first needs it — the shape for a token minted by the build itself, such as a
 * GitHub App installation token, so the comments carry the app's identity.
 */
export type CommentTokenSource =
  | AnyParameter
  | string
  | (() => Promise<string>);

/**
 * A fluent AI reviewer. Construct one via {@link securityReviewer} (and the
 * sibling factories), configure it, and attach it to a target with
 * `.validateBefore(...)` / `.validateAfter(...)`. `.provider(...)` and
 * `.apiKey(...)` are required; everything else has a default.
 */
export class Reviewer implements Validation {
  readonly #assessment: AssessmentType;
  #provider?: Provider;
  #apiKey?: AnyParameter | string;
  #model?: string;
  #effort?: Effort;
  #criteria = "";
  #criteriaFile?: string;
  #criteriaTokens = 8000;
  readonly #diff = new DiffSettings();
  readonly #include: string[] = [];
  readonly #exclude: string[] = [];
  #maxDiffTokens?: number;
  #gate: GateRule[] = [{ kind: "score", value: 7 }];
  #onError: "fail" | "warn" = "fail";
  #skipIfKeyMissing = false;
  #comment = false;
  #commentMode: "update" | "append" = "update";
  #commentToken?: CommentTokenSource;
  #retry?: RetryOptions;
  #quiet = false;
  #fetch?: typeof fetch;
  #exec?: (argv: string[]) => Promise<string>;
  #env: EnvReader = readEnv;
  #budget?: Budget;
  #cache?: AiCache;
  #suppress?: Suppressions;
  #conventionsFile?: string;
  #conventionsTokens = 8000;
  #fileContextTokens?: number;
  #verify = false;
  #discussion?: DiscussionSettings;

  /** A name for diagnostics — `"<assessment> review"`. */
  name: string;

  /** Create the reviewer for the given assessment type. */
  constructor(assessment: AssessmentType) {
    this.#assessment = assessment;
    this.name = `${assessment} review`;
  }

  /** The model provider, once `.provider(...)` has been called. */
  get provider_(): Provider | undefined {
    return this.#provider;
  }

  /** The configured API key (a parameter — for its env var — or a literal). */
  get apiKey_(): AnyParameter | string | undefined {
    return this.#apiKey;
  }

  /** Whether `.comment()` is set — i.e. this reviewer posts to the PR. */
  get commentEnabled_(): boolean {
    return this.#comment;
  }

  /** The configured comment-posting token, if `.commentToken(...)` was called. */
  get commentToken_(): CommentTokenSource | undefined {
    return this.#commentToken;
  }

  /**
   * Whether `.discussion((d) => d.threads())` is set — findings are anchored
   * to review threads, so a maintainer's reply in one is a rebuttal the
   * generated workflow should run the review for.
   */
  get threadsEnabled_(): boolean {
    return this.#discussion?.threads_() === true;
  }

  /** Set the model provider (required). */
  provider(provider: Provider): this {
    this.#provider = provider;
    return this;
  }

  /** Set the API key, from a secret parameter or a literal string (required). */
  apiKey(apiKey: AnyParameter | string): this {
    this.#apiKey = apiKey;
    return this;
  }

  /** Override the model (default: the provider's recommended model). */
  model(model: string): this {
    this.#model = model;
    return this;
  }

  /** Set the thinking-effort hint (honoured by Claude; ignored elsewhere). */
  effort(effort: Effort): this {
    this.#effort = effort;
    return this;
  }

  /**
   * Optional project-specific notes appended above the diff in the user prompt
   * — framing that fine-tunes the built-in rubric (e.g. "strict TypeScript,
   * no `any`/`as`"). Works for every reviewer; the assessment's own system
   * prompt already covers what to look for, so this is purely additive.
   *
   * These notes are **read from the head under review**, and cannot be
   * anything else: they are build code, evaluated by the very build the
   * pull request changed, so there is no base copy to read short of running
   * the base's build. A branch can therefore widen what its own review
   * overlooks, which is real but bounded — the change is first-party code in
   * the diff a maintainer reads, and a build that could not configure its own
   * reviewer from its own source would be a different feature.
   * {@link Reviewer.criteriaFile} is the base-anchored form for notes that
   * should not be editable by the change they judge.
   */
  criteria(criteria: string): this {
    this.#criteria = criteria;
    return this;
  }

  /** Configure the diff source (default: the working-tree diff, `git diff`). */
  diff(configure: Configure<DiffSettings>): this {
    configure(this.#diff);
    return this;
  }

  /** Only review files matching these globs (default: all files). */
  include(...globs: string[]): this {
    this.#include.push(...globs);
    return this;
  }

  /** Exclude files matching these globs (in addition to lockfiles). */
  exclude(...globs: string[]): this {
    this.#exclude.push(...globs);
    return this;
  }

  /** Cap the diff at roughly this many tokens, truncating the rest. */
  maxDiffTokens(tokens: number): this {
    this.#maxDiffTokens = tokens;
    return this;
  }

  /** Choose the gate that breaks the build (default: score above 7). */
  failWhen(configure: Configure<GateSettings>): this {
    const settings = new GateSettings();
    configure(settings);
    this.#gate = settings.rules_();
    return this;
  }

  /**
   * What to do when the review itself fails (API error, refusal, bad JSON):
   * `"fail"` breaks the build (default), `"warn"` logs and passes.
   */
  onError(mode: "fail" | "warn"): this {
    this.#onError = mode;
    return this;
  }

  /**
   * Retry the provider call on transient failures (`HTTP 408/429/500/502/503/
   * 504` and network errors). The default is on — three attempts with
   * exponential backoff and `Retry-After` honoured. Pass an object to override:
   * `{ attempts: 5 }` to retry more, or `{ attempts: 1 }` to disable.
   */
  retry(options: RetryOptions = {}): this {
    this.#retry = options;
    return this;
  }

  /**
   * Skip the review (instead of failing) when the API key is missing — handy
   * when the key is a CI-only secret. The skip is announced on the console and
   * in the job summary so the gap is visible.
   */
  skipIfKeyMissing(): this {
    this.#skipIfKeyMissing = true;
    return this;
  }

  /**
   * Also post the review to the pull/merge request as a comment. Works on
   * every supported CI host — GitHub Actions, GitLab CI, Azure Pipelines,
   * Bitbucket Pipelines — dispatched at runtime by {@link detectCiHost}. A
   * no-op outside a PR context (e.g. local runs). On each host the workflow
   * must grant the right scope: GitHub `pull-requests: write`, GitLab a token
   * with the `api` scope, Azure `System.AccessToken`, Bitbucket an app
   * password.
   *
   * `mode` chooses how re-runs post: `"update"` (default) keeps a single
   * comment per reviewer, edited in place; `"append"` posts a fresh comment
   * every run, so earlier assessments — and their finding ids — stay on the
   * thread as history. The discussion feature works with both: its state block
   * rides on every comment, and the newest one is read back.
   */
  comment(mode: "update" | "append" = "update"): this {
    this.#comment = true;
    this.#commentMode = mode;
    return this;
  }

  /**
   * The token used to post the PR/MR comment. Defaults to the active host's
   * conventional env var: `GITHUB_TOKEN` (GitHub), `GITLAB_TOKEN` (GitLab),
   * `SYSTEM_ACCESSTOKEN` (Azure), `BITBUCKET_TOKEN` (Bitbucket).
   *
   * A function is called each time a post needs the token — for a token that
   * does not exist until the build mints it, such as a GitHub App installation
   * token narrowed to `pull_requests: write`, which makes the comments the
   * app's rather than `github-actions[bot]`'s. A function that mints should
   * remember its result, since a review posts more than once. The generated
   * workflow cannot name a secret for a function, so it passes the host's
   * default token alongside, for the function to fall back to.
   */
  commentToken(token: CommentTokenSource): this {
    this.#commentToken = token;
    return this;
  }

  /** Backwards-compatible alias for {@link commentToken}. */
  githubToken(token: CommentTokenSource): this {
    return this.commentToken(token);
  }

  /** Suppress the findings printout and the job-summary section. */
  quiet(): this {
    this.#quiet = true;
    return this;
  }

  /** The `fetch` implementation for the API call (test seam). */
  fetch(impl: typeof fetch): this {
    this.#fetch = impl;
    return this;
  }

  /** The `git` runner used to produce the diff (test seam). */
  exec(run: (argv: string[]) => Promise<string>): this {
    this.#exec = run;
    return this;
  }

  /**
   * Environment reader used to auto-detect the base branch for
   * {@link "./diff.ts".DiffSettings.fetchBase} (reads `GITHUB_BASE_REF`). A test
   * seam; defaults to the process environment.
   */
  env(reader: EnvReader): this {
    this.#env = reader;
    return this;
  }

  /**
   * Attach a shared {@link Budget} that caps spend by an exact **token** count
   * (a USD cap is opt-in, computed from prices you supply to the budget). Pass
   * the same budget to several reviewers and a fixer to bound the whole build:
   * once the cap is reached, further reviews are skipped (not failed) with a
   * note, rather than running up the bill.
   */
  budget(budget: Budget): this {
    this.#budget = budget;
    return this;
  }

  /**
   * Reuse a prior model response for an identical review (same provider, model,
   * and prompt) instead of calling the API again — see {@link AiCache}. A cache
   * hit costs nothing and does not draw down the {@link budget}.
   */
  cache(cache: AiCache): this {
    this.#cache = cache;
    return this;
  }

  /**
   * Hide findings whose stable ID is in a {@link Suppressions} list — a learned
   * set of dismissed false positives. Every finding is fingerprinted and its ID
   * surfaced in the report, so dismissing one is a copy-paste into the list.
   *
   * Like {@link Reviewer.criteria}, the list is read at the **head** under
   * review — inline entries are build code, and the file is read from disk —
   * so a change can suppress a finding on its own run. That is deliberate:
   * every suppressed finding is still listed in the report, so the muting is
   * visible on the thread rather than silent, and the entry is in the diff a
   * maintainer reads. Nothing here reads the base, and nothing should be
   * assumed to.
   */
  suppress(suppressions: Suppressions): this {
    this.#suppress = suppressions;
    return this;
  }

  /**
   * Feed the project's conventions document (e.g. `AGENTS.md`) to the model as
   * reference material, so the review judges the change against the project's
   * documented rules instead of generic taste. When the diff has a base ref
   * (`.diff((d) => d.base(...))` or a successful `.fetchBase()`), the file is
   * read from that **base** via `git show` — never from the head under review,
   * so a pull request cannot rewrite the rules it is judged by. Without a base
   * (a local working-tree review) it is read from disk. Truncated at roughly
   * `maxTokens` (default 8000).
   */
  conventionsFile(path: string, maxTokens = 8000): this {
    this.#conventionsFile = path;
    this.#conventionsTokens = maxTokens;
    return this;
  }

  /**
   * Project-specific notes read from a **file**, appended to whatever
   * {@link Reviewer.criteria} set inline — the base-anchored half of the same
   * slot.
   *
   * Read exactly as {@link Reviewer.conventionsFile} is: from the diff's base
   * ref via `git show` when there is one, from disk otherwise, truncated at
   * roughly `maxTokens` (default 8000). That is the point of it. A note that
   * tells the reviewer a design is accepted — and so suppresses the findings
   * that restate it — is a rule the review is judged by, and a pull request
   * should not be able to add one to its own run. Keeping it in a file the
   * base supplies costs one merge of lag, which is the same lag the
   * conventions document already accepts, and is arguably the point: a newly
   * accepted design should be agreed before it starts muting findings.
   *
   * Use it for what a branch should not be able to widen; keep
   * {@link Reviewer.criteria} for the framing that travels with the build.
   *
   * What it does not buy: the build still decides *whether* to read a criteria
   * document at all, and that decision is head code, so a branch can drop the
   * call as easily as it can edit a string. This bounds what a change can add
   * to the rules of its own review, not whether the reviewer is configured —
   * the same limit {@link Reviewer.conventionsFile} has, and the reason the
   * diff a maintainer reads remains the control that matters.
   */
  criteriaFile(path: string, maxTokens = 8000): this {
    this.#criteriaFile = path;
    this.#criteriaTokens = maxTokens;
    return this;
  }

  /**
   * Also send the full post-image contents of the changed files (read via
   * `git show HEAD:<path>`), bounded at roughly `maxTokens` (default 12000) —
   * so the model can check a finding against the surrounding code (an existing
   * guard, a validation a few lines away) instead of judging hunks in
   * isolation. Skipped silently for a literal `.diff((d) => d.text(...))`
   * source with no repository behind it.
   */
  fileContext(maxTokens = 12000): this {
    this.#fileContextTokens = maxTokens;
    return this;
  }

  /**
   * Add an adversarial verification pass: after the review produces candidate
   * findings, a second model call re-checks each against the diff (and the
   * {@link fileContext}, when enabled) and refutes any whose failure path it
   * cannot concretely trace. Refuted candidates are listed in the report but
   * neither posted as findings nor gated on. Costs one extra API call per
   * review with findings; if the pass itself errors, the unverified findings
   * are kept (fail toward reporting, never toward silence).
   */
  verify(): this {
    this.#verify = true;
    return this;
  }

  /**
   * Engage with the pull-request discussion instead of repeating findings: the
   * reviewer reads the PR's comments, and when a **trusted** commenter (by the
   * host's own author metadata — see {@link DiscussionSettings}) contests a
   * finding by quoting its ID, an adjudication pass weighs the rebuttal on
   * technical merit and either upholds the finding (with the gap named) or
   * dismisses it. Dismissals persist across runs in a state block inside the
   * reviewer's own PR comment, so a dismissed finding — or a rewording of it —
   * does not resurface without new evidence. Requires {@link comment} (the
   * comment is where state lives) and a host that can list comments (GitHub
   * currently); elsewhere the discussion is skipped with a console note.
   *
   * Untrusted comments are dropped in code before any prompt is built — the
   * model never sees them, so a drive-by "the maintainer approved this"
   * comment cannot influence the review.
   */
  discussion(configure?: Configure<DiscussionSettings>): this {
    const settings = this.#discussion ?? new DiscussionSettings();
    this.#discussion = configure ? configure(settings) : settings;
    return this;
  }

  /** The `git` runner for diffs, `git show` reads, and conventions. */
  #run(): (argv: string[]) => Promise<string> {
    return this.#exec ?? ((argv: string[]) => new Command(argv).text());
  }

  /**
   * Resolve the diff text from the configured source, reporting a fetch that
   * failed. `fetchFailure` names the reason only when a fetch was asked for but
   * could not produce the diff — `.fetchBase()` offline, not a PR, an unsafe
   * ref, or the pull request `ZUKE_REVIEW_PR` names could not be fetched: the
   * caller must not let an empty fallback pass the gate silently. `baseRef` is
   * the ref the diff was taken against (`FETCH_HEAD` after a successful fetch,
   * the configured `.base(...)` otherwise) — the trusted side conventions are
   * read from — or `undefined` for a literal/working-tree diff. `headRef` is
   * where the changed files' contents are read from when it is not `HEAD`.
   *
   * A pull request named by `ZUKE_REVIEW_PR` takes precedence over every git
   * source (a literal `.text(...)` still wins): the job that sets it has the
   * default branch checked out, so any working-tree diff there is empty, and an
   * empty diff would pass the gate without reviewing anything. That is why its
   * failure is a failure and never a fallback.
   */
  async #resolveDiff(): Promise<
    { diff: string; fetchFailure?: string; baseRef?: string; headRef?: string }
  > {
    const text = this.#diff.text_();
    if (text !== undefined) return { diff: text };
    const run = this.#run();
    try {
      const pull = await fetchPullRequestDiff(run, this.#env);
      if (pull !== undefined) return pull;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { diff: "", fetchFailure: message };
    }
    // Honour `.fetchBase()` (fetch the base branch, diff against FETCH_HEAD) so
    // CI PR review needs no manual `git fetch`; fall through to the configured
    // source when no fetch was requested or it couldn't be done.
    const wantsFetch = this.#diff.fetch_() !== undefined;
    const fetched = await fetchBaseDiff(this.#diff, run, this.#env);
    if (fetched !== undefined) return { diff: fetched, baseRef: "FETCH_HEAD" };
    if (wantsFetch && !this.#quiet) {
      console.warn(
        `[${this.name}] fetchBase could not compute the base diff — ` +
          `falling back to the working-tree diff`,
      );
    }
    const base = this.#diff.base_();
    return {
      diff: await run(this.#diff.argv_()),
      ...(wantsFetch
        ? {
          fetchFailure:
            "could not compute the base diff (git fetch for the base branch failed)",
        }
        : {}),
      ...(base !== undefined ? { baseRef: base } : {}),
    };
  }

  /**
   * Resolve one of the reviewer's reference documents for the prompt: read
   * from the diff's base ref when there is one (so the change under review
   * cannot edit the rules it is judged by), from disk otherwise (a local
   * working-tree review), bounded to `maxTokens`. `undefined` when no path is
   * configured, or when the file is unreadable or empty.
   *
   * The conventions document and the criteria document differ only in which
   * path and cap they pass, and in the `what` they are called in a warning and
   * a truncation note — so they are one read, not two that can drift apart on
   * which ref they trust.
   */
  async #readReference(
    path: string | undefined,
    baseRef: string | undefined,
    maxTokens: number,
    what: string,
  ): Promise<string | undefined> {
    if (path === undefined) return undefined;
    let text: string | undefined;
    if (baseRef !== undefined) {
      try {
        text = await this.#run()(["git", "show", `${baseRef}:${path}`]);
      } catch {
        text = undefined;
      }
      if (text === undefined && !this.#quiet) {
        console.warn(
          `[${this.name}] could not read ${path} from ${baseRef} — ` +
            `reviewing without the ${what}`,
        );
      }
    } else {
      text = await readTextOrUndefined(path);
    }
    if (text === undefined || text.trim() === "") return undefined;
    return truncate(text, maxTokens, what);
  }

  /**
   * Report the assessment unless quiet — to the console, the job summary, and
   * (when `.comment()` is set) the pull request.
   */
  async #report(
    assessment: Assessment,
    target: string,
    redact: Redact,
    usage?: Usage,
    extras: ReportExtras = {},
    commentExtra?: string,
  ): Promise<void> {
    if (this.#quiet) return;
    const lines = consoleLines(this.name, assessment, usage, extras);
    for (const line of lines) console.log(line);
    await this.#publish(
      toMarkdown(this.name, target, assessment, usage, extras),
      redact,
      commentExtra,
    );
  }

  /**
   * When a suppress list is attached, drop the dismissed findings (they are
   * fingerprinted by then). Returns the suppressed findings (so the report can
   * list them — suppression mutes the gate, it does not erase the record).
   */
  async #applySuppression(
    assessment: Assessment,
  ): Promise<AssessmentFinding[]> {
    if (this.#suppress === undefined) return [];
    const suppressed = await this.#suppress.load_();
    if (suppressed.size === 0) return [];
    const kept: AssessmentFinding[] = [];
    const dropped: AssessmentFinding[] = [];
    for (const finding of assessment.findings) {
      const id = finding.id;
      if (id !== undefined && suppressed.has(id)) dropped.push(finding);
      else kept.push(finding);
    }
    if (dropped.length === 0) return [];
    assessment.findings = kept;
    return dropped;
  }

  /**
   * Announce a skipped review unless quiet — on the console, the job summary,
   * and (when `.comment()` is set) the pull request.
   */
  async #reportSkip(
    target: string,
    reason: string,
    redact: Redact,
  ): Promise<void> {
    if (this.#quiet) return;
    console.log(skipConsoleLine(this.name, reason));
    await this.#publish(skipMarkdown(this.name, target, reason), redact);
  }

  /**
   * The comment-posting token for `host`: the configured source — called, when
   * it is a function — or the host's default env var.
   */
  #resolveCommentToken(host: { defaultTokenEnv: string }): Promise<string> {
    const source = this.#commentToken;
    if (typeof source === "function") return source();
    return Promise.resolve(
      source !== undefined
        ? resolveKey(source)
        : this.#env(host.defaultTokenEnv) ?? "",
    );
  }

  /**
   * Append `markdown` to the job summary and, if enabled, the PR comment.
   * `commentExtra` (the hidden discussion-state block) goes only to the PR
   * comment — the job summary has no next run to carry state to.
   */
  async #publish(
    markdown: string,
    redact: Redact,
    commentExtra?: string,
  ): Promise<void> {
    writeStepSummary(markdown);
    if (!this.#comment) return;
    const host = detectReviewHost(this.#env);
    if (host === undefined) {
      console.warn(
        `[${this.name}] no PR-comment host detected — skipping comment`,
      );
      return;
    }
    const token = await this.#resolveCommentToken(host);
    const upsert = host.prepare(token, this.#env);
    if (upsert === undefined) {
      console.warn(
        `[${this.name}] no ${host.label} PR context — skipping comment`,
      );
      return;
    }
    // Masked here, at the one place this class posts a comment, so a caller
    // cannot leak by forgetting to. The state block is included: it is built
    // from the same assessment the markdown is.
    const body = redact(
      commentExtra === undefined ? markdown : `${markdown}\n${commentExtra}`,
    );
    try {
      await upsert(this.name, body, this.#fetch ?? fetch, this.#commentMode);
    } catch (error) {
      // Best-effort: a failed comment must never break the build.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${this.name}] could not post PR comment: ${message}`);
    }
  }

  /**
   * Fetch the PR comments and the reviewer's prior state for the discussion
   * feature. `undefined` disables the discussion for this run: not configured,
   * `.comment()` missing (state lives in the comment), no capable host, no PR
   * context, or the listing failed. State is only decoded from a comment the
   * host attributes to a bot account — a state block pasted into a human's
   * comment is never trusted (an Actions token's own comments are bot-authored;
   * a PAT-driven local run simply starts fresh).
   */
  async #prepareDiscussion(): Promise<
    { comments: HostComment[]; priorState?: ReviewState } | undefined
  > {
    if (this.#discussion === undefined) return undefined;
    const warn = (reason: string) => {
      if (!this.#quiet) {
        console.warn(`[${this.name}] discussion disabled — ${reason}`);
      }
    };
    if (!this.#comment) {
      warn("it requires .comment(), where the discussion state lives");
      return undefined;
    }
    const host = detectReviewHost(this.#env);
    if (host?.listComments === undefined) {
      warn("the active host cannot list PR comments");
      return undefined;
    }
    const list = host.listComments(
      await this.#resolveCommentToken(host),
      this.#env,
    );
    if (list === undefined) return undefined; // no PR context (local run)
    try {
      const comments = await list(this.#fetch ?? fetch);
      const marker = commentMarker(this.name);
      // Scan newest-first: in append mode many of the reviewer's comments
      // carry the marker, and the newest one holds the current state (in
      // update mode there is only one, so newest == the one). The marker must
      // OPEN the body — the reviewer's own comments always lead with it, so a
      // bot that merely quotes another comment (prefixing its own text) can
      // never be adopted as the state carrier.
      let own: HostComment | undefined;
      for (let i = comments.length - 1; i >= 0; i--) {
        const c = comments[i];
        if (c.bot && c.body.startsWith(marker)) {
          own = c;
          break;
        }
      }
      const priorState = own !== undefined ? decodeState(own.body) : undefined;
      return {
        comments,
        ...(priorState !== undefined ? { priorState } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`could not list PR comments: ${message}`);
      return undefined;
    }
  }

  /**
   * Run a verdict pass (verify or adjudicate) against the provider, recording
   * usage against the budget. Throws on API or parse errors — callers catch
   * and fail toward keeping findings visible.
   */
  async #verdictCall(
    provider: Provider,
    key: string,
    model: string,
    prompts: { system: string; user: string },
    allowed: string[],
    retry: RetryOptions,
  ): Promise<Map<string, Verdict>> {
    const result = await callProvider(
      provider,
      key,
      model,
      prompts.system,
      prompts.user,
      {
        effort: this.#effort,
        fetch: this.#fetch,
        retry,
        schema: {
          json: verdictsJsonSchema(allowed),
          gemini: verdictsGeminiSchema(allowed),
        },
        schemaName: "verdicts",
      },
    );
    this.#budget?.record_(result.usage, model);
    return parseVerdicts(result.text, allowed);
  }

  /**
   * Resolve findings the model reworded back onto the identity the review state
   * already holds, so a fresh fingerprint stops evading every id-keyed stage
   * below. Two paths, cheapest first: an alias recorded in an earlier round is
   * a plain lookup, and only what is left over costs one capped verdict call.
   *
   * The pass can only **rename** — see `dedup.ts`. Every skip and failure here
   * leaves the finding under its own fresh id, which means it is reported and
   * gates: the fail-safe direction is always toward saying more, never less.
   */
  async #resolveRewordings(
    findings: AssessmentFinding[],
    priorState: ReviewState | undefined,
    call: {
      provider: Provider;
      key: string;
      model: string;
      retry: RetryOptions;
    },
  ): Promise<RewordResult> {
    const result: RewordResult = {
      rewordedFrom: new Map(),
      newAliases: new Map(),
      notes: [],
    };
    if (priorState === undefined) return result;
    const record = (adoptions: Adoption[]): void => {
      for (const adoption of adoptions) {
        result.rewordedFrom.set(adoption.prior.id, adoption.prior.title);
        result.newAliases.set(adoption.prior.id, adoption.alias);
        if (adoption.prior.status === "fixed") {
          result.notes.push(
            `"${adoption.prior.title}" was recorded as fixed but is reported ` +
              `again in different words — reopened under ${adoption.prior.id}`,
          );
        }
      }
    };
    // Free path: a rewording an earlier round already paid to identify.
    const aliases = aliasIndex(priorState);
    if (aliases.size > 0) {
      const known = new Map<string, StoredFinding>();
      for (const finding of findings) {
        const prior = finding.id !== undefined
          ? aliases.get(finding.id)
          : undefined;
        // Through the same gate the paid path uses: a fingerprint does not
        // encode severity, so an alias alone cannot show that this round's
        // finding is no worse than the decision it would inherit.
        if (prior !== undefined && eligible(finding, prior)) {
          known.set(finding.id ?? "", prior);
        }
      }
      record(adoptCanonicalIds(findings, known));
    }
    // Paid path: only findings whose identity is still unknown to the state,
    // compared against every entry a rename could resolve onto — including the
    // ones still open. A reworded finding that is merely still open must be
    // recognised too: left unmatched, its old id goes unreported this round and
    // the progress pass records it as fixed, so the report claims a resolution
    // that never happened and lists the same concern twice.
    const ids = new Set(priorState.findings.map((finding) => finding.id));
    const candidates = findings.filter((finding) =>
      finding.id !== undefined && !ids.has(finding.id)
    );
    const priors = [...priorState.findings];
    // Fixed first, then dismissed and refuted, then the still-open ones. Fixed
    // before the decided ones keeps a candidate matching both reopening (which
    // reports) rather than inheriting a dismissal (which silences); decided
    // entries before open ones keeps the newcomers from crowding a sticky
    // decision out of the per-candidate comparison cap.
    const order = (finding: StoredFinding): number =>
      finding.status === "fixed"
        ? 0
        : finding.status === "dismissed" || finding.status === "refuted"
        ? 1
        : 2;
    priors.sort((a, b) => order(a) - order(b));
    if (candidates.length === 0 || priors.length === 0) return result;
    const plan = planDedup(candidates, priors);
    if (plan.pairs.length === 0) return result;
    if (this.#budget?.exhausted_() ?? false) {
      result.notes.push(
        "reworded-finding check skipped — AI budget exhausted; a reworded " +
          "finding is reported again under a new id",
      );
      return result;
    }
    try {
      const verdicts = await this.#verdictCall(
        call.provider,
        call.key,
        call.model,
        buildDedupPrompt(this.#assessment, dedupNotes(plan)),
        DEDUP_VERDICTS,
        call.retry,
      );
      const { matches, ambiguous } = sameAs(plan, verdicts);
      record(adoptCanonicalIds(findings, matches));
      for (const id of ambiguous) {
        result.notes.push(
          `${id} matched more than one earlier finding — kept the first ` +
            `comparison offered`,
        );
      }
      const capped = dedupCapNote(plan);
      if (capped !== undefined) result.notes.push(capped);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.notes.push(
        `reworded-finding check failed (${message}) — findings keep their ` +
          `own identity`,
      );
    }
    return result;
  }

  /**
   * The trusted, budgeted rebuttals for `ids`, keyed by finding id: comments
   * quoting an id, merged with the replies in the reviewer's own threads.
   * Thread replies join the same trust gate and the same one token budget as
   * the id-quoting channel, appended last so the budget's newest-first walk
   * keeps them — enabling threads cannot double the untrusted text a prompt
   * sees. A reply's finding comes from its thread's marker, never its text.
   */
  #collectRebuttals(
    comments: HostComment[],
    threadCtx: ThreadContext | undefined,
    settings: DiscussionSettings,
    ids: string[],
  ): Map<string, HostComment[]> {
    const replies = threadCtx === undefined
      ? []
      : allReplies(threadCtx.threads);
    const trusted = budgetComments(
      trustedComments([...comments, ...replies], settings),
      settings,
    );
    const quoted = rebuttalsFor(trusted, ids);
    return threadCtx === undefined
      ? quoted
      : withThreadRebuttals(quoted, trusted, threadCtx.threads, ids);
  }

  /** What the review-thread phase in `threads_phase.ts` needs from this reviewer. */
  #threadSettings(redact: Redact): ThreadPhaseSettings {
    return {
      name: this.name,
      quiet: this.#quiet,
      env: this.#env,
      doFetch: this.#fetch ?? fetch,
      token: (host) => this.#resolveCommentToken(host),
      redact,
    };
  }

  /**
   * Run the review and gate the build. Throws an {@link AiReviewError} when the
   * gate trips (or on a configuration/API error with `onError: "fail"`).
   */
  async validate(context: ValidationContext): Promise<void> {
    const provider = this.#provider;
    if (provider === undefined) {
      throw new AiReviewError("a provider is required; call .provider(...)");
    }
    const key = resolveKey(this.#apiKey);
    if (key === "") {
      if (this.#skipIfKeyMissing) {
        await this.#reportSkip(context.target, "no API key", context.redact);
        return;
      }
      throw new AiReviewError("an API key is required; call .apiKey(...)");
    }
    const model = this.#model ?? DEFAULT_MODELS[provider];
    if (!this.#quiet) {
      console.log(reviewStartLine(this.name, {
        target: context.target,
        provider,
        model,
        gate: describeGate(this.#gate),
        comment: this.#comment,
      }));
    }

    const resolved = await this.#resolveDiff();
    let diff = filterDiff(
      resolved.diff,
      this.#include,
      [...DEFAULT_EXCLUDES, ...this.#exclude],
    ).trim();
    if (diff === "") {
      // A requested fetchBase that failed leaves an empty working-tree fallback
      // on a clean CI checkout, and a pull request that could not be fetched
      // leaves nothing at all. Passing that as an empty assessment would let the
      // gate go green without reviewing anything — a silent security bypass. Fail
      // (or, under `onError: "warn"`, skip visibly), never pass silently.
      if (resolved.fetchFailure !== undefined) {
        const reason = resolved.fetchFailure;
        if (this.#onError === "warn") {
          await this.#reportSkip(context.target, reason, context.redact);
          return;
        }
        throw new AiReviewError(
          `${this.name} of "${context.target}" ${reason}; refusing to pass on an empty fallback diff`,
        );
      }
      await this.#report(emptyAssessment(), context.target, context.redact);
      return;
    }
    if (this.#maxDiffTokens !== undefined) {
      diff = truncate(diff, this.#maxDiffTokens);
    }

    // Extra context for a deeper review: the conventions document and the
    // criteria document (both read from the diff base, never the head under
    // review), the changed files' full contents, and the findings dismissed in
    // earlier discussion rounds.
    const conventions = await this.#readReference(
      this.#conventionsFile,
      resolved.baseRef,
      this.#conventionsTokens,
      "conventions document",
    );
    // The effective project notes: what the build set inline, then what the
    // base's criteria document adds. The inline half travels with the change;
    // only this half is beyond its reach.
    const criteriaDoc = await this.#readReference(
      this.#criteriaFile,
      resolved.baseRef,
      this.#criteriaTokens,
      "criteria document",
    );
    const criteria = [this.#criteria, criteriaDoc ?? ""]
      .filter((part) => part !== "")
      .join("\n\n");
    let files: string | undefined;
    if (
      this.#fileContextTokens !== undefined && this.#diff.text_() === undefined
    ) {
      const built = await buildFileContext(
        changedPaths(diff),
        this.#run(),
        this.#fileContextTokens,
        resolved.headRef ?? "HEAD",
      );
      files = built === "" ? undefined : built;
    }
    const discussion = await this.#prepareDiscussion();
    const threadCtx =
      discussion === undefined || this.#discussion?.threads_() !== true
        ? undefined
        : await prepareThreads(this.#threadSettings(context.redact));
    const dismissedPrior = dismissedOf(discussion?.priorState);
    const openPrior = openOf(discussion?.priorState);
    const fixedPrior = fixedOf(discussion?.priorState);
    const refutedPrior = refutedOf(discussion?.priorState);
    const dismissedLines = [...dismissedPrior.values()].map((f) =>
      stateLine(f, true)
    );
    // Earlier rounds' refutations ride in with their evidence, so the model is
    // not left to rediscover a concern already disproved against this code.
    const refutedLines = [...refutedPrior.values()].map((f) =>
      stateLine(f, true)
    );
    // The previous round's still-open findings, for the model to re-assess:
    // re-reported → still open; omitted → recorded as fixed below.
    const priorLines = [...openPrior.values()].map((f) => stateLine(f, false));
    const extras: PromptExtras = {
      ...(conventions !== undefined ? { conventions } : {}),
      ...(files !== undefined ? { files } : {}),
      ...(dismissedLines.length > 0 ? { dismissed: dismissedLines } : {}),
      ...(refutedLines.length > 0 ? { refuted: refutedLines } : {}),
      ...(priorLines.length > 0 ? { prior: priorLines } : {}),
    };

    const { system, user } = buildPrompt(
      this.#assessment,
      criteria,
      diff,
      extras,
    );
    // Announce each retry (unless quiet) so a slow run looks like progress.
    const retry = {
      ...this.#retry,
      onRetry: this.#quiet ? undefined : (info: RetryInfo) => {
        console.warn(retryLine(this.name, info));
      },
    };
    // Cost cache: an identical review (same provider, model, effort, and prompt)
    // reuses the prior response instead of paying for another call.
    let call: CachedResult<Assessment> | BudgetExhausted;
    try {
      call = await cachedCall({
        provider,
        key,
        model,
        system,
        user,
        parse: parseAssessment,
        cache: this.#cache,
        budget: this.#budget,
        effort: this.#effort,
        fetch: this.#fetch,
        retry,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.#onError === "warn") {
        console.warn(`[${this.name}] skipped: ${message}`);
        return;
      }
      throw error instanceof AiReviewError ? error : new AiReviewError(message);
    }
    if ("exhausted" in call) {
      await this.#reportSkip(
        context.target,
        `AI budget exhausted — ${call.exhausted}`,
        context.redact,
      );
      return;
    }
    const assessment = call.value;
    const usage = call.usage;
    const fromCache = call.fromCache;

    // Fingerprint immediately: every later stage (sticky dismissal, verify,
    // adjudication, suppression) keys on the stable id.
    for (const finding of assessment.findings) {
      finding.id = findingFingerprint(this.#assessment, finding);
    }

    // Identity resolution: a reworded finding arrives under a fresh fingerprint
    // and would evade every id-keyed stage below — sticky dismissal, rebuttal
    // matching, the progress record. Rename it back onto the identity the state
    // already holds, free from a recorded alias or by one capped call. This
    // only renames: the decision it inherits was earned in an earlier round.
    const reword: RewordResult = discussion === undefined
      ? { rewordedFrom: new Map(), newAliases: new Map(), notes: [] }
      : await this.#resolveRewordings(
        assessment.findings,
        discussion.priorState,
        { provider, key, model, retry },
      );

    // Sticky dismissals: a finding dismissed in an earlier discussion round is
    // dropped deterministically by id (the prompt already told the model not to
    // re-report rewordings; this catches an identical resurfacing without
    // spending a model call on it). Recorded in the report, never silent.
    const dismissed: DismissedFinding[] = [];
    if (dismissedPrior.size > 0) {
      const kept: AssessmentFinding[] = [];
      for (const finding of assessment.findings) {
        const prior = finding.id !== undefined
          ? dismissedPrior.get(finding.id)
          : undefined;
        if (prior !== undefined) {
          const earlier = finding.id !== undefined
            ? reword.rewordedFrom.get(finding.id)
            : undefined;
          dismissed.push({
            finding,
            ...(prior.author !== undefined ? { author: prior.author } : {}),
            ...(prior.rationale !== undefined
              ? { reason: prior.rationale }
              : {}),
            ...(earlier !== undefined ? { rewordedFrom: earlier } : {}),
          });
        } else kept.push(finding);
      }
      assessment.findings = kept;
    }

    // Rebuttals, gathered once the ids are canonical and before any decision a
    // trusted reply may change, for every finding of interest: reported this
    // round, still open from the last one, or refuted before.
    const rebuttals = discussion === undefined || this.#discussion === undefined
      ? new Map<string, HostComment[]>()
      : this.#collectRebuttals(
        discussion.comments,
        threadCtx,
        this.#discussion,
        [
          ...assessment.findings
            .map((f) => f.id)
            .filter((id): id is string => id !== undefined),
          ...openPrior.keys(),
          ...refutedPrior.keys(),
        ],
      );

    // Sticky refutations: a finding the verify pass disproved in an earlier
    // round is dropped deterministically — but only while everything that
    // verifier saw is byte-identical, which is when the evidence it cited
    // cannot have changed, and only while no maintainer has contested it.
    // Either sends the finding back to the verifier below carrying the earlier
    // refutation, so the model alone never silences a finding for good: the
    // drop is bounded by evidence, re-asked as soon as the code moves, and a
    // trusted human can always demand the re-check by replying in its thread.
    const refuted: RefutedFinding[] = [];
    const runNotes: string[] = [];
    const evidence = await sha256Hex(`${diff}\n${files ?? ""}`);
    if (refutedPrior.size > 0) {
      const kept: AssessmentFinding[] = [];
      for (const finding of assessment.findings) {
        const id = finding.id ?? "";
        const prior = refutedPrior.get(id);
        if (prior === undefined) {
          kept.push(finding);
          continue;
        }
        const contested = rebuttals.has(id);
        if (prior.evidence === evidence && !contested) {
          refuted.push({
            finding,
            earlier: true,
            ...(prior.rationale !== undefined
              ? { reason: prior.rationale }
              : {}),
          });
          continue;
        }
        if (contested) {
          runNotes.push(
            `"${finding.title}" was refuted in an earlier round and a ` +
              `maintainer replied in its thread — sent back to the verifier`,
          );
        }
        kept.push(finding);
      }
      assessment.findings = kept;
    }

    // Verify pass: adversarially re-check each candidate. Only a refutation
    // that states its concrete contrary evidence removes a finding (an
    // evidence-free one demotes to uncertain below — the requirement is
    // enforced in code, not just asked for in the prompt); removal is
    // reported in the refuted table, auditable, not gated on. A
    // confirmed or uncertain candidate stays reported and gating, carrying the
    // verdict so the report shows how far verification got. A missing verdict
    // and a failed pass both keep the finding unmarked — fail toward
    // reporting, never toward silence. A candidate refuted in an earlier round
    // (whose diff section has since changed) carries that refutation in, so
    // the verifier re-checks the evidence instead of starting from nothing.
    const verified = new Set<string>();
    if (this.#verify && assessment.findings.length > 0) {
      if (this.#budget?.exhausted_()) {
        if (!this.#quiet) {
          console.warn(
            `[${this.name}] verify pass skipped — AI budget exhausted`,
          );
        }
      } else {
        try {
          const candidates = assessment.findings.map((f) => {
            const earlier = f.id !== undefined
              ? refutedPrior.get(f.id)?.rationale
              : undefined;
            return {
              id: f.id ?? "",
              title: f.title,
              ...(f.file !== undefined ? { file: f.file } : {}),
              ...(f.line !== undefined ? { line: f.line } : {}),
              ...(f.detail !== undefined ? { detail: f.detail } : {}),
              ...(earlier !== undefined ? { refutedBefore: earlier } : {}),
            };
          });
          const verdicts = await this.#verdictCall(
            provider,
            key,
            model,
            buildVerifyPrompt(this.#assessment, candidates, diff, extras),
            ["confirmed", "refuted", "uncertain"],
            retry,
          );
          const kept: AssessmentFinding[] = [];
          for (const finding of assessment.findings) {
            const verdict = finding.id !== undefined
              ? verdicts.get(finding.id)
              : undefined;
            if (verdict !== undefined) verified.add(finding.id ?? "");
            // The evidence requirement is enforced here, not just asked for in
            // the prompt: a refutation that states no reason cited nothing, so
            // it demotes to uncertain — the finding stays visible — rather
            // than silencing a finding on an evidence-free veto.
            const reason = verdict?.verdict === "refuted"
              ? (verdict.reason ?? "").trim()
              : "";
            if (verdict?.verdict === "refuted" && reason !== "") {
              refuted.push({ finding, reason });
            } else {
              // Confirmed keeps its verdict; an uncertain answer and an
              // evidence-free refutation both surface as uncertain; an
              // unanswered candidate stays unmarked (fail-safe).
              if (verdict !== undefined) {
                finding.verification = verdict.verdict === "confirmed"
                  ? "confirmed"
                  : "uncertain";
              }
              kept.push(finding);
            }
          }
          assessment.findings = kept;
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : String(error);
          if (!this.#quiet) {
            console.warn(
              `[${this.name}] verify pass failed (${message}) — keeping ` +
                `unverified findings`,
            );
          }
        }
      }
    }
    // A finding refuted in an earlier round that is reported this round is
    // back for one of two reasons, and the report says which: the verifier
    // re-checked it against the changed code and it stands (confirmed or
    // uncertain), or no verifier could be consulted — the pass is off, was
    // skipped for budget, or failed — and the earlier decision is not trusted
    // blind. Both fail toward reporting.
    for (const finding of assessment.findings) {
      const id = finding.id ?? "";
      if (!refutedPrior.has(id)) continue;
      runNotes.push(
        verified.has(id)
          ? `"${finding.title}" was refuted in an earlier round but stands ` +
            `against the changed code — reported again under ${id}`
          : `"${finding.title}" was refuted in an earlier round and could ` +
            `not be re-verified this round — reported again under ${id}`,
      );
    }

    // Adjudication: when a trusted maintainer contested a finding by quoting
    // its id, weigh the rebuttal. Both keys are required for a dismissal — a
    // trusted rebuttal (checked in code) AND the model accepting it on merit —
    // so neither an insistent comment nor the model alone can mute a finding.
    const upheldReasons = new Map<string, string>();
    if (discussion !== undefined) {
      const reported = assessment.findings
        .map((f) => f.id)
        .filter((id): id is string => id !== undefined);
      // Contested findings the model did not re-report this round — or that
      // the verify pass refuted — are adjudicated too, rather than recorded as
      // fixed by default: a maintainer who argued a finding away is owed the
      // answer "dismissed", which is sticky and said so in the thread, where a
      // "fixed" that fixed nothing reopens on the next rewording.
      const unreported = [...openPrior.values()].filter((prior) =>
        !reported.includes(prior.id)
      );
      // A reply on a finding refuted before asks for a re-check, not a
      // dismissal: it was sent back to the verifier above, whose answer is the
      // reply. Everything else contested is adjudicated.
      const contested = new Map(
        [...rebuttals].filter(([id]) => !refutedPrior.has(id)),
      );
      if (contested.size > 0 && !(this.#budget?.exhausted_() ?? false)) {
        try {
          const notes: RebuttalNote[] = [];
          for (const [id, comments] of contested) {
            const finding = assessment.findings.find((f) => f.id === id);
            const subject = finding ?? openPrior.get(id);
            if (subject === undefined) continue;
            notes.push({
              id,
              title: subject.title,
              ...(finding?.detail !== undefined
                ? { detail: finding.detail }
                : {}),
              comments: comments.map((c) =>
                rebuttalComment(
                  c.displayName ?? c.author,
                  c.association,
                  c.body,
                )
              ),
            });
          }
          const verdicts = await this.#verdictCall(
            provider,
            key,
            model,
            buildAdjudicatePrompt(this.#assessment, notes, diff),
            ["upheld", "dismissed"],
            retry,
          );
          // A contested finding the model returned no verdict for stays open —
          // but say so, otherwise a hedging model silently swallows the whole
          // discussion round and the maintainer's rebuttal seems ignored.
          const unanswered = notes
            .map((n) => n.id)
            .filter((id) => !verdicts.has(id));
          if (unanswered.length > 0 && !this.#quiet) {
            console.warn(
              `[${this.name}] adjudication returned no verdict for ` +
                `${unanswered.join(", ")} — contested findings stay open`,
            );
          }
          // A "dismissed" verdict only counts for a finding that actually had
          // a trusted rebuttal — the model cannot dismiss on its own.
          const accepted = (id: string, verdict: Verdict) =>
            verdict.verdict === "dismissed" && contested.has(id);
          const accept = (finding: AssessmentFinding, verdict: Verdict) => {
            const rebutter = contested.get(verdict.id)?.[0];
            dismissed.push({
              finding,
              author: rebutter?.displayName ?? rebutter?.author,
              ...(verdict.reason !== undefined
                ? { reason: verdict.reason }
                : {}),
            });
          };
          const kept: AssessmentFinding[] = [];
          for (const finding of assessment.findings) {
            const id = finding.id;
            const verdict = id !== undefined ? verdicts.get(id) : undefined;
            if (
              id !== undefined && verdict !== undefined && accepted(id, verdict)
            ) {
              accept(finding, verdict);
            } else {
              if (id !== undefined && verdict?.verdict === "upheld") {
                upheldReasons.set(id, verdict.reason ?? "");
              }
              kept.push(finding);
            }
          }
          assessment.findings = kept;
          // The contested findings that were not re-reported: an accepted
          // rebuttal dismisses (and outranks this round's refutation of the
          // same finding — two keys beat one); one that does not hold changes
          // nothing, since the finding is not reported either way, but the
          // report says so rather than letting the argument vanish.
          for (const prior of unreported) {
            const verdict = verdicts.get(prior.id);
            if (verdict === undefined || !contested.has(prior.id)) continue;
            if (accepted(prior.id, verdict)) {
              accept({
                id: prior.id,
                title: prior.title,
                severity: prior.severity,
                ...(prior.file !== undefined ? { file: prior.file } : {}),
              }, verdict);
              const index = refuted.findIndex((r) => r.finding.id === prior.id);
              if (index >= 0) refuted.splice(index, 1);
            } else {
              const because = verdict.reason !== undefined &&
                  verdict.reason !== ""
                ? ` (${verdict.reason})`
                : "";
              runNotes.push(
                `the rebuttal for "${prior.title}" (${prior.id}) did not ` +
                  `hold on its own${because}, but the finding no longer ` +
                  `reproduces — recorded as ${
                    refuted.some((r) => r.finding.id === prior.id)
                      ? "refuted"
                      : "fixed"
                  }`,
              );
            }
          }
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : String(error);
          if (!this.#quiet) {
            console.warn(
              `[${this.name}] adjudication failed (${message}) — contested ` +
                `findings stay open`,
            );
          }
        }
      }
    }

    // Progress tracking: a prior open finding that is neither re-reported nor
    // dismissed this round no longer reproduces — mark it fixed. Prior fixed
    // findings stay fixed (cumulative progress) unless re-reported, in which
    // case the current finding wins and the entry reopens. Computed before
    // suppression, so a suppressed re-report never masquerades as a fix.
    const fixed: StoredFinding[] = [];
    if (discussion !== undefined) {
      const still = new Set<string>();
      for (const finding of assessment.findings) {
        if (finding.id !== undefined) still.add(finding.id);
      }
      for (const d of dismissed) {
        if (d.finding.id !== undefined) still.add(d.finding.id);
      }
      // Refuted is a decision about a live finding, not the absence of one: a
      // prior open finding the verifier disproved is recorded refuted below,
      // never as fixed.
      for (const r of refuted) {
        if (r.finding.id !== undefined) still.add(r.finding.id);
      }
      for (const prior of fixedPrior.values()) {
        if (!still.has(prior.id)) fixed.push(prior);
      }
      for (const prior of openPrior.values()) {
        if (!still.has(prior.id)) {
          fixed.push({
            ...prior,
            status: "fixed",
            rationale: "no longer reproduces against the current diff",
          });
        }
      }
    }

    const suppressed = await this.#applySuppression(assessment);
    if (dismissed.length + refuted.length + suppressed.length > 0) {
      lowerAssessment(assessment);
    }

    // Persist the discussion state inside the PR comment: current findings as
    // open/upheld, every dismissal (prior rounds' and this round's) kept
    // sticky, and every fixed finding kept as the progress record. Current
    // findings are written last so a re-reported fixed finding reopens.
    let commentExtra: string | undefined;
    if (discussion !== undefined) {
      // The alias ledger: every rewording earlier rounds paid to identify, plus
      // this round's. Merged into each entry as it is written, so rebuilding an
      // entry (a reopen, a re-dismissal) cannot drop a rewording already paid
      // for and make the next round buy it again.
      const ledger = new Map<string, string[]>();
      for (const prior of discussion.priorState?.findings ?? []) {
        if (prior.aliases !== undefined) ledger.set(prior.id, prior.aliases);
      }
      for (const [id, alias] of reword.newAliases) {
        ledger.set(id, mergeAliases(ledger.get(id), [alias], id));
      }
      const withAliases = (entry: StoredFinding): StoredFinding => {
        const aliases = ledger.get(entry.id);
        return aliases === undefined || aliases.length === 0
          ? entry
          : { ...entry, aliases };
      };
      const stored = new Map<string, StoredFinding>();
      for (const prior of dismissedPrior.values()) {
        stored.set(prior.id, withAliases(prior));
      }
      for (const entry of fixed) stored.set(entry.id, withAliases(entry));
      // Refutations: earlier rounds' carried forward as they stand, this
      // round's written with the verifier's reason and the digest of what it
      // saw — the two things the next round compares. A finding re-refuted
      // after its input changed refreshes both; one an accepted rebuttal
      // dismissed was removed from this list above.
      for (const prior of refutedPrior.values()) {
        stored.set(prior.id, withAliases(prior));
      }
      for (const r of refuted) {
        const id = r.finding.id ?? "";
        if (id === "" || r.earlier === true) continue;
        const prior = refutedPrior.get(id) ?? openPrior.get(id) ??
          fixedPrior.get(id);
        stored.set(
          id,
          withAliases({
            id,
            title: prior?.title ?? r.finding.title,
            severity: r.finding.severity,
            status: "refuted",
            ...(r.finding.file !== undefined ? { file: r.finding.file } : {}),
            ...(r.reason !== undefined ? { rationale: r.reason } : {}),
            evidence,
          }),
        );
      }
      for (const d of dismissed) {
        const id = d.finding.id ?? "";
        if (id === "") continue;
        // A dismissal already on record keeps the wording, rationale and author
        // the maintainer actually argued about. Re-stamping it with this
        // round's rewording would churn the state block and, over rounds, bury
        // the real reason under a succession of titles.
        const prior = dismissedPrior.get(id);
        stored.set(
          id,
          withAliases(
            prior ?? {
              id,
              title: d.finding.title,
              severity: d.finding.severity,
              status: "dismissed",
              ...(d.finding.file !== undefined ? { file: d.finding.file } : {}),
              ...(d.reason !== undefined ? { rationale: d.reason } : {}),
              ...(d.author !== undefined ? { author: d.author } : {}),
            },
          ),
        );
      }
      for (const finding of assessment.findings) {
        const id = finding.id ?? "";
        if (id === "") continue;
        const upheld = upheldReasons.get(id);
        stored.set(
          id,
          withAliases({
            id,
            title: finding.title,
            severity: finding.severity,
            status: upheld !== undefined ? "upheld" : "open",
            ...(finding.file !== undefined ? { file: finding.file } : {}),
            ...(upheld !== undefined && upheld !== ""
              ? { rationale: upheld }
              : {}),
          }),
        );
      }
      commentExtra = encodeState({ findings: [...stored.values()] });
    }

    // Posted after suppression and after the state block, so no thread is ever
    // opened for a finding that verify refuted, adjudication dismissed or the
    // suppress list muted — and before #report, which is the only publish, so
    // an unanchored finding's note reaches the comment rather than the void.
    // Skipped under `.quiet()` along with the report: quiet means the reviewer
    // does not speak. Posting threads while withholding the summary would be
    // worse than either — the anchored findings would appear on the pull
    // request and the unanchorable ones nowhere at all.
    const threadNotes = threadCtx === undefined || this.#quiet
      ? []
      : await postThreads(
        this.#threadSettings(context.redact),
        threadCtx,
        {
          open: assessment.findings,
          dismissed: dismissed.map((d) => ({
            id: d.finding.id ?? "",
            ...(d.reason !== undefined ? { reason: d.reason } : {}),
          })),
          dismissedPrior: new Set(dismissedPrior.keys()),
          refuted: refuted.map((r) => ({
            id: r.finding.id ?? "",
            ...(r.reason !== undefined ? { reason: r.reason } : {}),
            ...(r.earlier === true ? { earlier: true } : {}),
          })),
          fixed: fixed.map((entry) => entry.id),
          fixedPrior: new Set(fixedPrior.keys()),
          upheld: upheldReasons,
          threads: threadCtx.threads,
          anchors: anchorableLines(diff),
        },
      );
    await this.#report(assessment, context.target, context.redact, usage, {
      suppressed: suppressed.length,
      suppressedFindings: suppressed,
      fromCache,
      budget: this.#budget?.describe_(),
      ...(refuted.length > 0 ? { refuted } : {}),
      ...(dismissed.length > 0 ? { dismissed } : {}),
      ...(fixed.length > 0 ? { fixed } : {}),
      ...(reword.notes.length + runNotes.length + threadNotes.length > 0
        ? { notes: [...reword.notes, ...runNotes, ...threadNotes] }
        : {}),
      discussion: discussion !== undefined,
    }, commentExtra);
    const gate = gateTrips(assessment, this.#gate);
    if (gate.tripped) {
      throw new AiReviewError(
        `${this.name} of "${context.target}" failed: ${gate.reason}. ${assessment.summary}`,
      );
    }
  }
}

/**
 * One stored finding as a prompt line: `id — title (file)`, plus `: rationale`
 * when the block carries the decision's evidence (a dismissal, a refutation)
 * rather than a still-open finding to re-assess.
 */
function stateLine(finding: StoredFinding, withRationale: boolean): string {
  const file = finding.file !== undefined ? ` (${finding.file})` : "";
  const why = withRationale && finding.rationale !== undefined
    ? `: ${finding.rationale}`
    : "";
  return `${finding.id} — ${finding.title}${file}${why}`;
}

/**
 * Removing findings (suppression, verified refutation, discussion dismissal)
 * can only lower the bar: recompute severity AND score from what's left.
 * Recomputing severity alone would leave the original score, so a score-based
 * gate (the default, score > 7) would still fail after a critical false
 * positive is removed. Never raises the score.
 */
function lowerAssessment(assessment: Assessment): void {
  if (assessment.findings.length === 0) {
    assessment.score = 0;
    assessment.severity = "none";
    return;
  }
  let highest: Severity = "none";
  for (const finding of assessment.findings) {
    if (rank(finding.severity) > rank(highest)) highest = finding.severity;
  }
  assessment.severity = highest;
  assessment.score = Math.min(assessment.score, severityScore(highest));
}

/** Construct a {@link Reviewer} for `assessment` and apply the lambda. */
function makeReviewer(
  assessment: AssessmentType,
  configure?: Configure<Reviewer>,
): Reviewer {
  const reviewer = new Reviewer(assessment);
  return configure ? configure(reviewer) : reviewer;
}

/**
 * A general-purpose reviewer scored on code quality and maintainability. Pair
 * with `.criteria(...)` to add project-specific notes (idioms, conventions, a
 * coding-style document); the built-in rubric is sufficient without them.
 */
export function genericReviewer(configure?: Configure<Reviewer>): Reviewer {
  return makeReviewer("generic", configure);
}

/** A reviewer that scores the diff for security vulnerabilities. */
export function securityReviewer(configure?: Configure<Reviewer>): Reviewer {
  return makeReviewer("security", configure);
}

/** A reviewer that scans the diff for leaked secrets and credentials. */
export function secretsReviewer(configure?: Configure<Reviewer>): Reviewer {
  return makeReviewer("secrets", configure);
}

/** A reviewer that scores the diff for correctness bugs and regressions. */
export function correctnessReviewer(configure?: Configure<Reviewer>): Reviewer {
  return makeReviewer("correctness", configure);
}

/** A reviewer that scores the diff for license and compliance risk. */
export function licenseReviewer(configure?: Configure<Reviewer>): Reviewer {
  return makeReviewer("license", configure);
}
