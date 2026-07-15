/**
 * The fluent {@link Reviewer} and its per-assessment factory functions — the
 * orchestration that ties the diff source, provider, parser, and gate together
 * behind the {@link Validation} contract.
 *
 * @module
 */

import type { AnyParameter, Validation, ValidationContext } from "@zuke/core";
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
  filterDiff,
  truncate,
} from "./diff.ts";
import {
  describeGate,
  type GateRule,
  GateSettings,
  gateTrips,
} from "./gate.ts";
import { buildPrompt } from "./prompt.ts";
import { callProvider, DEFAULT_MODELS, resolveKey } from "./provider.ts";
import { emptyAssessment, parseAssessment } from "./assessment.ts";
import {
  consoleLines,
  type ReportExtras,
  retryLine,
  reviewStartLine,
  skipConsoleLine,
  skipMarkdown,
  toMarkdown,
  writeStepSummary,
} from "./report.ts";
import { detectReviewHost, readEnv } from "./hosts.ts";
import type { RetryInfo, RetryOptions } from "./retry.ts";
import type { Budget } from "./budget.ts";
import type { AiCache } from "./cache.ts";
import { findingFingerprint, type Suppressions } from "./suppress.ts";
import { rank } from "./severity.ts";

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
  readonly #diff = new DiffSettings();
  readonly #include: string[] = [];
  readonly #exclude: string[] = [];
  #maxDiffTokens?: number;
  #gate: GateRule[] = [{ kind: "score", value: 7 }];
  #onError: "fail" | "warn" = "fail";
  #skipIfKeyMissing = false;
  #comment = false;
  #commentToken?: AnyParameter | string;
  #retry?: RetryOptions;
  #quiet = false;
  #fetch?: typeof fetch;
  #exec?: (argv: string[]) => Promise<string>;
  #budget?: Budget;
  #cache?: AiCache;
  #suppress?: Suppressions;

  /** A name for diagnostics — `"<assessment> review"`. */
  name: string;

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
  get commentToken_(): AnyParameter | string | undefined {
    return this.#commentToken;
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
   * single comment per reviewer is kept up to date across re-runs. A no-op
   * outside a PR context (e.g. local runs). On each host the workflow must
   * grant the right scope: GitHub `pull-requests: write`, GitLab a token with
   * the `api` scope, Azure `System.AccessToken`, Bitbucket an app password.
   */
  comment(): this {
    this.#comment = true;
    return this;
  }

  /**
   * The token used to post the PR/MR comment. Defaults to the active host's
   * conventional env var: `GITHUB_TOKEN` (GitHub), `GITLAB_TOKEN` (GitLab),
   * `SYSTEM_ACCESSTOKEN` (Azure), `BITBUCKET_TOKEN` (Bitbucket).
   */
  commentToken(token: AnyParameter | string): this {
    this.#commentToken = token;
    return this;
  }

  /** Backwards-compatible alias for {@link commentToken}. */
  githubToken(token: AnyParameter | string): this {
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
   */
  suppress(suppressions: Suppressions): this {
    this.#suppress = suppressions;
    return this;
  }

  /** Resolve the diff text from the configured source. */
  async #resolveDiff(): Promise<string> {
    const text = this.#diff.text_();
    if (text !== undefined) return text;
    const run = this.#exec ?? ((argv: string[]) => new Command(argv).text());
    return await run(this.#diff.argv_());
  }

  /**
   * Report the assessment unless quiet — to the console, the job summary, and
   * (when `.comment()` is set) the pull request.
   */
  async #report(
    assessment: Assessment,
    target: string,
    usage?: Usage,
    extras: ReportExtras = {},
  ): Promise<void> {
    if (this.#quiet) return;
    const lines = consoleLines(this.name, assessment, usage, extras);
    for (const line of lines) console.log(line);
    await this.#publish(
      toMarkdown(this.name, target, assessment, usage, extras),
    );
  }

  /**
   * Fingerprint every finding (so its ID shows in the report) and, when a
   * suppress list is attached, drop the dismissed ones. Returns the suppressed
   * findings (so the report can list them — suppression mutes the gate, it does
   * not erase the record). When suppression empties the findings, the score and
   * severity are cleared so the gate sees a clean assessment.
   */
  async #applySuppression(
    assessment: Assessment,
  ): Promise<AssessmentFinding[]> {
    for (const finding of assessment.findings) {
      finding.id = findingFingerprint(this.#assessment, finding);
    }
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
    if (kept.length === 0) {
      assessment.score = 0;
      assessment.severity = "none";
    } else {
      // Suppression can only lower the bar: recompute severity from what's left.
      let highest: Severity = "none";
      for (const finding of kept) {
        if (rank(finding.severity) > rank(highest)) highest = finding.severity;
      }
      assessment.severity = highest;
    }
    return dropped;
  }

  /**
   * Announce a skipped review unless quiet — on the console, the job summary,
   * and (when `.comment()` is set) the pull request.
   */
  async #reportSkip(target: string, reason: string): Promise<void> {
    if (this.#quiet) return;
    console.log(skipConsoleLine(this.name, reason));
    await this.#publish(skipMarkdown(this.name, target, reason));
  }

  /** Append `markdown` to the job summary and, if enabled, the PR comment. */
  async #publish(markdown: string): Promise<void> {
    writeStepSummary(markdown);
    if (!this.#comment) return;
    const host = detectReviewHost();
    if (host === undefined) {
      console.warn(
        `[${this.name}] no PR-comment host detected — skipping comment`,
      );
      return;
    }
    const token = this.#commentToken !== undefined
      ? resolveKey(this.#commentToken)
      : readEnv(host.defaultTokenEnv) ?? "";
    const upsert = host.prepare(token, readEnv);
    if (upsert === undefined) {
      console.warn(
        `[${this.name}] no ${host.label} PR context — skipping comment`,
      );
      return;
    }
    try {
      await upsert(this.name, markdown, this.#fetch ?? fetch);
    } catch (error) {
      // Best-effort: a failed comment must never break the build.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${this.name}] could not post PR comment: ${message}`);
    }
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
        await this.#reportSkip(context.target, "no API key");
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

    let diff = filterDiff(
      await this.#resolveDiff(),
      this.#include,
      [...DEFAULT_EXCLUDES, ...this.#exclude],
    ).trim();
    if (diff === "") {
      await this.#report(emptyAssessment(), context.target);
      return;
    }
    if (this.#maxDiffTokens !== undefined) {
      diff = truncate(diff, this.#maxDiffTokens);
    }

    const { system, user } = buildPrompt(
      this.#assessment,
      this.#criteria,
      diff,
    );
    // Announce each retry (unless quiet) so a slow run looks like progress.
    const retry = {
      ...this.#retry,
      onRetry: this.#quiet ? undefined : (info: RetryInfo) => {
        console.warn(retryLine(this.name, info));
      },
    };
    // Cost cache: an identical review (same provider, model, and prompt) reuses
    // the prior response instead of paying for another call.
    const cacheKey = this.#cache?.enabled_()
      ? this.#cache.key_([provider, model, system, user])
      : undefined;
    const cached = cacheKey !== undefined
      ? await this.#cache?.get_(cacheKey)
      : undefined;

    let assessment: Assessment;
    let usage: Usage | undefined;
    let fromCache = false;
    if (cached !== undefined) {
      assessment = parseAssessment(cached.text);
      usage = cached.usage;
      fromCache = true;
    } else if (this.#budget?.exhausted_()) {
      await this.#reportSkip(
        context.target,
        `AI budget exhausted — ${this.#budget.describe_()}`,
      );
      return;
    } else {
      try {
        const result = await callProvider(
          provider,
          key,
          model,
          system,
          user,
          { effort: this.#effort, fetch: this.#fetch, retry },
        );
        assessment = parseAssessment(result.text);
        usage = result.usage;
        this.#budget?.record_(usage, model);
        if (cacheKey !== undefined) {
          await this.#cache?.put_(cacheKey, result.text, usage);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.#onError === "warn") {
          console.warn(`[${this.name}] skipped: ${message}`);
          return;
        }
        throw error instanceof AiReviewError
          ? error
          : new AiReviewError(message);
      }
    }

    const suppressed = await this.#applySuppression(assessment);
    await this.#report(assessment, context.target, usage, {
      suppressed: suppressed.length,
      suppressedFindings: suppressed,
      fromCache,
      budget: this.#budget?.describe_(),
    });
    const gate = gateTrips(assessment, this.#gate);
    if (gate.tripped) {
      throw new AiReviewError(
        `${this.name} of "${context.target}" failed: ${gate.reason}. ${assessment.summary}`,
      );
    }
  }
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
