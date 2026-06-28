import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  Budget,
  budget,
  type BudgetSpend,
  type ModelPrice,
} from "../src/budget.ts";

/** A model id used throughout; prices are supplied per-test via PRICES. */
const CLAUDE = "claude-opus-4-8";

/** Sample user-supplied prices (USD per 1M tokens) — no prices ship by default. */
const PRICES: Record<string, ModelPrice> = {
  "claude-opus-4-8": { input: 15, output: 75 },
  "gemini-3.5-flash": { input: 0.3, output: 1.2 },
};

Deno.test("a fresh budget with no caps is never exhausted", () => {
  const b = new Budget();
  assertEquals(b.exhausted_(), false);
  b.record_({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, CLAUDE);
  // No cap is set, so even a large spend leaves it un-exhausted.
  assertEquals(b.exhausted_(), false);
});

Deno.test("a token cap exhausts at or above the cap, not just under it", () => {
  const b = budget((x) => x.maxTokens(1_000));
  b.record_({ totalTokens: 999 }, "unpriced-model");
  assertEquals(b.exhausted_(), false); // just under the cap
  b.record_({ totalTokens: 1 }, "unpriced-model");
  assertEquals(b.exhausted_(), true); // exactly at the cap
});

Deno.test("a cost cap exhausts once a priced call crosses it", () => {
  // With a supplied $15/1M input price, 1M input tokens = $15.
  const b = budget((x) => x.maxCost(10).prices(PRICES));
  b.record_({ inputTokens: 500_000 }, CLAUDE); // $7.50, under the cap
  assertEquals(b.exhausted_(), false);
  b.record_({ inputTokens: 500_000 }, CLAUDE); // now $15.00, over the cap
  assertEquals(b.exhausted_(), true);
});

Deno.test("a cost cap is ignored while no priced call has been recorded", () => {
  const b = budget((x) => x.maxCost(0.000001));
  b.record_({ inputTokens: 10_000_000 }, "unpriced-model");
  // Cost is unknown (no priced call), so the cost cap can't fire.
  assertEquals(b.exhausted_(), false);
  const spend = b.spend_();
  assertEquals(spend.cost, undefined);
});

Deno.test(".prices() sets prices for several models", () => {
  const table: Record<string, ModelPrice> = {
    [CLAUDE]: { input: 1, output: 1 },
    "custom-model": { input: 2, output: 4 },
  };
  const b = budget((x) => x.prices(table));
  b.record_({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, CLAUDE);
  // 1M*$1 + 1M*$1 = $2.
  assertEquals(b.spend_().cost, 2);
  b.record_(
    { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    "custom-model",
  );
  // Adds 1M*$2 + 1M*$4 = $6, total $8.
  assertEquals(b.spend_().cost, 8);
});

Deno.test(".prices() merges across calls rather than replacing", () => {
  const b = new Budget();
  b.prices({ "a-model": { input: 1, output: 1 } });
  b.prices({ "b-model": { input: 2, output: 2 } });
  b.record_({ inputTokens: 1_000_000 }, "a-model"); // still known after 2nd merge
  b.record_({ inputTokens: 1_000_000 }, "b-model");
  assertEquals(b.spend_().cost, 3);
});

Deno.test("record_ tolerates undefined usage and still counts the call", () => {
  const b = new Budget().prices(PRICES);
  b.record_(undefined, CLAUDE);
  const spend = b.spend_();
  assertEquals(spend.calls, 1);
  assertEquals(spend.totalTokens, 0);
  // The model is priced, but zero tokens means a $0 cost — still "known".
  assertEquals(spend.cost, 0);
});

Deno.test("record_ with only input tokens derives the total from input", () => {
  const b = new Budget();
  b.record_({ inputTokens: 42 }, "unpriced-model");
  const spend = b.spend_();
  assertEquals(spend.inputTokens, 42);
  assertEquals(spend.outputTokens, 0);
  assertEquals(spend.totalTokens, 42);
});

Deno.test("record_ with only a provider-reported total is preferred", () => {
  const b = new Budget();
  b.record_({ totalTokens: 100 }, "unpriced-model");
  const spend = b.spend_();
  assertEquals(spend.inputTokens, 0);
  assertEquals(spend.outputTokens, 0);
  assertEquals(spend.totalTokens, 100);
});

Deno.test("record_ with both input and output sums them when no total given", () => {
  const b = new Budget();
  b.record_({ inputTokens: 30, outputTokens: 70 }, "unpriced-model");
  assertEquals(b.spend_().totalTokens, 100);
});

Deno.test("record_ prefers a provider total over input + output", () => {
  const b = new Budget();
  // Provider total disagrees with input + output — the total wins.
  b.record_({ inputTokens: 30, outputTokens: 70, totalTokens: 250 }, "x");
  assertEquals(b.spend_().totalTokens, 250);
});

Deno.test("remainingTokens_ reports the gap and is undefined without a cap", () => {
  const uncapped = new Budget();
  assertEquals(uncapped.remainingTokens_(), undefined);

  const capped = budget((x) => x.maxTokens(1_000));
  assertEquals(capped.remainingTokens_(), 1_000);
  capped.record_({ totalTokens: 250 }, "unpriced-model");
  assertEquals(capped.remainingTokens_(), 750);
});

Deno.test("remainingTokens_ clamps at zero once the cap is overshot", () => {
  const b = budget((x) => x.maxTokens(100));
  b.record_({ totalTokens: 250 }, "unpriced-model");
  assertEquals(b.remainingTokens_(), 0);
});

Deno.test("spend_ snapshots every accumulated field", () => {
  const b = new Budget().prices(PRICES);
  b.record_({ inputTokens: 10, outputTokens: 5 }, CLAUDE);
  b.record_({ inputTokens: 20, outputTokens: 10 }, CLAUDE);
  const spend: BudgetSpend = b.spend_();
  assertEquals(spend.calls, 2);
  assertEquals(spend.inputTokens, 30);
  assertEquals(spend.outputTokens, 15);
  assertEquals(spend.totalTokens, 45);
  assertEquals(spend.cost !== undefined && spend.cost > 0, true);
});

Deno.test("describe_ shows totals, cost, and both caps when priced and capped", () => {
  const b = budget((x) => x.maxTokens(10_000).maxCost(1).prices(PRICES));
  b.record_({ inputTokens: 1_234 }, CLAUDE);
  const text = b.describe_();
  assertStringIncludes(text, "1,234 tokens"); // thousands separator
  assertStringIncludes(text, "~$"); // a known cost is shown
  assertStringIncludes(text, "of 10,000 tokens"); // the token cap
  assertStringIncludes(text, "$1.00"); // the cost cap
});

Deno.test("describe_ omits the cost when no priced call was recorded", () => {
  const b = budget((x) => x.maxTokens(500));
  b.record_({ totalTokens: 100 }, "unpriced-model");
  const text = b.describe_();
  assertStringIncludes(text, "100 tokens");
  assertStringIncludes(text, "of 500 tokens");
  assertEquals(text.includes("~$"), false); // no cost estimate without a price
});

Deno.test("describe_ shows just the total when uncapped", () => {
  const b = new Budget();
  b.record_({ totalTokens: 7 }, "unpriced-model");
  const text = b.describe_();
  assertEquals(text, "7 tokens");
  assertEquals(text.includes("of "), false);
});

Deno.test("describe_ uses up to four decimals for sub-cent costs", () => {
  const b = new Budget().prices(PRICES);
  // A few thousand cheap tokens lands well under a cent.
  b.record_({ inputTokens: 1_000 }, "gemini-3.5-flash"); // $0.0003
  const text = b.describe_();
  assertStringIncludes(text, "$0.0003");
});

Deno.test("describe_ shows a cost cap on its own when no token cap is set", () => {
  const b = budget((x) => x.maxCost(2.5).prices(PRICES));
  b.record_({ inputTokens: 1_000 }, CLAUDE);
  const text = b.describe_();
  assertStringIncludes(text, "of $2.50");
  assertEquals(text.includes("tokens of"), false); // no token cap precedes it
});

Deno.test("budget() returns a usable Budget without a configure lambda", () => {
  const b = budget();
  assertEquals(b instanceof Budget, true);
  assertEquals(b.exhausted_(), false);
});

Deno.test("budget() applies the configure lambda and returns the same instance", () => {
  const b = budget((x) => x.maxTokens(5));
  assertEquals(b.remainingTokens_(), 5);
});

Deno.test("no prices are configured by default, so cost stays unknown", () => {
  const b = new Budget();
  // The default models are NOT priced out of the box — supply your own.
  b.record_({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, CLAUDE);
  assertEquals(b.spend_().cost, undefined);
  // A cost cap can't fire without a supplied price, even on a huge spend.
  b.maxCost(0.000001);
  assertEquals(b.exhausted_(), false);
});
