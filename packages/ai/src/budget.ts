/**
 * A token and cost budget for AI provider calls.
 *
 * A {@link Budget} folds each provider call's reported {@link Usage} into
 * running totals (calls, input/output/total tokens) and — when the call's
 * model has a known price — an estimated USD cost. A caller can cap either the
 * total tokens ({@link Budget.maxTokens}) or the estimated cost
 * ({@link Budget.maxCost}) and ask {@link Budget.exhausted_} before each call to
 * stop once a cap is reached, so a runaway loop or an unexpectedly expensive
 * model can't burn the whole bill.
 *
 * Prices live in {@link DEFAULT_PRICES} (USD per 1,000,000 tokens, keyed by
 * model id) and are approximate; override or extend them per-budget with
 * {@link Budget.prices}. A model with no known price still contributes to the
 * token totals — only its cost is left out, and a cost cap is only enforced
 * once at least one priced call has been recorded.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import type { Usage } from "./types.ts";

/** Per-model price in USD per 1,000,000 tokens. */
export interface ModelPrice {
  /** USD per 1,000,000 input (prompt) tokens. */
  input: number;
  /** USD per 1,000,000 output (completion) tokens. */
  output: number;
}

/** A snapshot of what a {@link Budget} has consumed so far. */
export interface BudgetSpend {
  /** How many provider calls were recorded. */
  calls: number;
  /** Total input (prompt) tokens across all recorded calls. */
  inputTokens: number;
  /** Total output (completion) tokens across all recorded calls. */
  outputTokens: number;
  /** Total tokens (input + output) across all recorded calls. */
  totalTokens: number;
  /** Estimated USD cost, when at least one recorded call had a known price. */
  cost?: number;
}

/**
 * Default USD-per-1,000,000-token prices keyed by model id. These are
 * approximate published list prices and are meant as a sensible default — pass
 * your own table to {@link Budget.prices} to override or extend them (e.g. for
 * a negotiated rate or a model not listed here).
 */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "claude-opus-4-8": { input: 15, output: 75 },
  "gpt-5.4-mini": { input: 0.4, output: 1.6 },
  "gemini-3.5-flash": { input: 0.3, output: 1.2 },
};

/** Tokens per priced unit — prices are quoted per 1,000,000 tokens. */
const TOKENS_PER_UNIT = 1_000_000;

/**
 * Group an integer's digits with comma thousands-separators, deterministically
 * (no locale lookup) — e.g. `1234` → `"1,234"`. Used by
 * {@link Budget.describe_} so its output is hermetic and reproducible.
 */
function withCommas(value: number): string {
  const negative = value < 0;
  const digits = Math.trunc(Math.abs(value)).toString();
  let grouped = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ",";
    grouped += digits[i];
  }
  return negative ? `-${grouped}` : grouped;
}

/**
 * Format a USD amount with 2–4 decimal places: two for amounts of a cent or
 * more, up to four for sub-cent estimates so a tiny cost doesn't read as `$0.00`.
 */
function formatUsd(usd: number): string {
  const decimals = usd !== 0 && Math.abs(usd) < 0.01 ? 4 : 2;
  return `$${usd.toFixed(decimals)}`;
}

/**
 * A running token and cost budget for AI provider calls. Build one with
 * {@link budget}, set caps with the fluent setters, then fold each call's usage
 * in with {@link Budget.record_} and gate further calls on
 * {@link Budget.exhausted_}.
 */
export class Budget {
  /** Running count of recorded provider calls. */
  private calls_ = 0;
  /** Running total of input (prompt) tokens. */
  private inputTokens_ = 0;
  /** Running total of output (completion) tokens. */
  private outputTokens_ = 0;
  /** Running total of all tokens (input + output). */
  private totalTokens_ = 0;
  /** Running estimated USD cost across priced calls. */
  private cost_ = 0;
  /** Whether any recorded call had a known price (else cost is unknown). */
  private priced_ = false;
  /** The total-token cap, or `undefined` when no token cap is set. */
  private maxTokens__?: number;
  /** The estimated-cost cap in USD, or `undefined` when no cost cap is set. */
  private maxCost__?: number;
  /** Per-budget price overrides, merged over {@link DEFAULT_PRICES}. */
  private priceOverrides_: Record<string, ModelPrice> = {};

  /** Cap total tokens (input + output across all recorded calls). */
  maxTokens(total: number): this {
    this.maxTokens__ = total;
    return this;
  }

  /** Cap estimated USD cost. Requires the call's model to have a known price. */
  maxCost(usd: number): this {
    this.maxCost__ = usd;
    return this;
  }

  /** Override/extend the price table (merged over DEFAULT_PRICES), keyed by model id. */
  prices(table: Record<string, ModelPrice>): this {
    this.priceOverrides_ = { ...this.priceOverrides_, ...table };
    return this;
  }

  /** The effective price for a model, or `undefined` when none is known. */
  private priceFor_(model: string): ModelPrice | undefined {
    if (Object.hasOwn(this.priceOverrides_, model)) {
      return this.priceOverrides_[model];
    }
    if (Object.hasOwn(DEFAULT_PRICES, model)) return DEFAULT_PRICES[model];
    return undefined;
  }

  /** INTERNAL: whether a configured cap has already been reached. */
  exhausted_(): boolean {
    if (
      this.maxTokens__ !== undefined && this.totalTokens_ >= this.maxTokens__
    ) {
      return true;
    }
    if (
      this.maxCost__ !== undefined && this.priced_ &&
      this.cost_ >= this.maxCost__
    ) {
      return true;
    }
    return false;
  }

  /** INTERNAL: fold one provider call's usage into the running totals. */
  record_(usage: Usage | undefined, model: string): void {
    this.calls_++;
    const input = usage?.inputTokens ?? 0;
    const output = usage?.outputTokens ?? 0;
    // Prefer the provider's total; otherwise sum whatever counts were present
    // (a missing input or output already defaulted to 0 above).
    const total = usage?.totalTokens ?? input + output;
    this.inputTokens_ += input;
    this.outputTokens_ += output;
    this.totalTokens_ += total;
    const price = this.priceFor_(model);
    if (price !== undefined) {
      this.cost_ += input / TOKENS_PER_UNIT * price.input +
        output / TOKENS_PER_UNIT * price.output;
      this.priced_ = true;
    }
  }

  /** INTERNAL: a snapshot of consumption so far. */
  spend_(): BudgetSpend {
    return {
      calls: this.calls_,
      inputTokens: this.inputTokens_,
      outputTokens: this.outputTokens_,
      totalTokens: this.totalTokens_,
      ...(this.priced_ ? { cost: this.cost_ } : {}),
    };
  }

  /** INTERNAL: remaining tokens before the cap, or undefined when no token cap. */
  remainingTokens_(): number | undefined {
    if (this.maxTokens__ === undefined) return undefined;
    return Math.max(0, this.maxTokens__ - this.totalTokens_);
  }

  /** INTERNAL: a one-line human summary, e.g. "1,234 tokens (~$0.01) of 10,000 / $1.00". */
  describe_(): string {
    let summary = `${withCommas(this.totalTokens_)} tokens`;
    if (this.priced_) summary += ` (~${formatUsd(this.cost_)})`;
    const caps: string[] = [];
    if (this.maxTokens__ !== undefined) {
      caps.push(`${withCommas(this.maxTokens__)} tokens`);
    }
    if (this.maxCost__ !== undefined) caps.push(formatUsd(this.maxCost__));
    if (caps.length > 0) summary += ` of ${caps.join(" / ")}`;
    return summary;
  }
}

/**
 * Construct a {@link Budget}, applying an optional configure lambda so caps can
 * be set inline — e.g. `budget((b) => b.maxTokens(100_000).maxCost(1))`.
 */
export function budget(configure?: Configure<Budget>): Budget {
  const b = new Budget();
  return configure ? configure(b) : b;
}
