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
import type { Assessment, AssessmentType, Effort, Provider } from "./types.ts";
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

  /** The rubric for a {@link genericReviewer} (required for generic reviews). */
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
   * Skip the review (instead of failing) when the API key is missing — handy
   * when the key is a CI-only secret. The skip is announced on the console and
   * in the job summary so the gap is visible.
   */
  skipIfKeyMissing(): this {
    this.#skipIfKeyMissing = true;
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
   * Report the assessment unless quiet — to the console, and (under GitHub
   * Actions) as a Markdown section appended to the job summary.
   */
  #report(assessment: Assessment, target: string): void {
    if (this.#quiet) return;
    for (const line of consoleLines(this.name, assessment)) console.log(line);
    writeStepSummary(toMarkdown(this.name, target, assessment));
  }

  /**
   * Announce a skipped review unless quiet — on the console, and (under GitHub
   * Actions) as a Markdown note appended to the job summary.
   */
  #reportSkip(target: string, reason: string): void {
    if (this.#quiet) return;
    console.log(skipConsoleLine(this.name, reason));
    writeStepSummary(skipMarkdown(this.name, target, reason));
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
        this.#reportSkip(context.target, "no API key");
        return;
      }
      throw new AiReviewError("an API key is required; call .apiKey(...)");
    }
    if (this.#assessment === "generic" && this.#criteria === "") {
      throw new AiReviewError(
        "genericReviewer needs review criteria; call .criteria(...)",
      );
    }

    let diff = filterDiff(
      await this.#resolveDiff(),
      this.#include,
      [...DEFAULT_EXCLUDES, ...this.#exclude],
    ).trim();
    if (diff === "") {
      this.#report(emptyAssessment(), context.target);
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
    try {
      const text = await callProvider(
        provider,
        key,
        this.#model ?? DEFAULT_MODELS[provider],
        system,
        user,
        { effort: this.#effort, fetch: this.#fetch },
      );
      assessment = parseAssessment(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.#onError === "warn") {
        console.warn(`[${this.name}] skipped: ${message}`);
        return;
      }
      throw error instanceof AiReviewError ? error : new AiReviewError(message);
    }

    this.#report(assessment, context.target);
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
 * A general-purpose reviewer. Requires `.criteria(...)` describing what to
 * assess and how to score it, in addition to `.provider(...)`/`.apiKey(...)`.
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
