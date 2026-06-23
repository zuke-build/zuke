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
  AssessmentType,
  Effort,
  Provider,
  Usage,
} from "./types.ts";
import { AiReviewError } from "./errors.ts";
import {
  DEFAULT_EXCLUDES,
  DiffSettings,
  filterDiff,
  truncate,
} from "./diff.ts";
import { type GateRule, GateSettings, gateTrips } from "./gate.ts";
import { buildPrompt } from "./prompt.ts";
import { callProvider, DEFAULT_MODELS, resolveKey } from "./provider.ts";
import { emptyAssessment, parseAssessment } from "./assessment.ts";
import {
  consoleLines,
  skipConsoleLine,
  skipMarkdown,
  toMarkdown,
  writeStepSummary,
} from "./report.ts";
import { readEnv, resolveGithubContext, upsertPrComment } from "./github.ts";
import type { RetryOptions } from "./retry.ts";

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
  #githubToken?: AnyParameter | string;
  #retry?: RetryOptions;
  #quiet = false;
  #fetch?: typeof fetch;
  #exec?: (argv: string[]) => Promise<string>;

  /** A name for diagnostics — `"<assessment> review"`. */
  name: string;

  constructor(assessment: AssessmentType) {
    this.#assessment = assessment;
    this.name = `${assessment} review`;
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
    this.#gate = settings.rules_;
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
   * Also post the review to the pull request as a comment (GitHub Actions). A
   * single comment per reviewer is kept up to date across re-runs. Needs a token
   * with `pull-requests: write` — the workflow `GITHUB_TOKEN` by default, or one
   * set with {@link githubToken}. A no-op outside a GitHub PR context.
   */
  comment(): this {
    this.#comment = true;
    return this;
  }

  /**
   * The token used to post the PR comment (default: the `GITHUB_TOKEN` env var).
   */
  githubToken(token: AnyParameter | string): this {
    this.#githubToken = token;
    return this;
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

  /** Resolve the diff text from the configured source. */
  async #resolveDiff(): Promise<string> {
    if (this.#diff.text_ !== undefined) return this.#diff.text_;
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
  ): Promise<void> {
    if (this.#quiet) return;
    const lines = consoleLines(this.name, assessment, usage);
    for (const line of lines) console.log(line);
    await this.#publish(toMarkdown(this.name, target, assessment, usage));
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
    const token = this.#githubToken !== undefined
      ? resolveKey(this.#githubToken)
      : readEnv("GITHUB_TOKEN") ?? "";
    const context = resolveGithubContext(token);
    if (context === undefined) {
      console.warn(`[${this.name}] no PR context — skipping comment`);
      return;
    }
    try {
      await upsertPrComment(context, this.name, markdown, this.#fetch ?? fetch);
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
    let assessment: Assessment;
    let usage: Usage | undefined;
    try {
      const result = await callProvider(
        provider,
        key,
        this.#model ?? DEFAULT_MODELS[provider],
        system,
        user,
        { effort: this.#effort, fetch: this.#fetch, retry: this.#retry },
      );
      assessment = parseAssessment(result.text);
      usage = result.usage;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.#onError === "warn") {
        console.warn(`[${this.name}] skipped: ${message}`);
        return;
      }
      throw error instanceof AiReviewError ? error : new AiReviewError(message);
    }

    await this.#report(assessment, context.target, usage);
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
