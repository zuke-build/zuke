/**
 * Unit tests for the outcome views behind `ctx.outcomeOf(...)` — how a status
 * and a run-record row become the shape a target body reads.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { outcomesFromRecord, outcomeView } from "../src/run_support.ts";
import type { TargetRunState } from "../src/state/types.ts";

/** A record row, with only the fields a case cares about set. */
function row(over: Partial<TargetRunState> = {}): TargetRunState {
  return { status: "succeeded", meta: {}, ...over };
}

Deno.test("a status with no record row is the whole view", () => {
  assertEquals(outcomeView("succeeded", undefined), { status: "succeeded" });
});

Deno.test("the row contributes its detail but never its status", () => {
  // The row is the durable copy and can be a write behind the status passed in,
  // so carrying `row.status` over would reintroduce exactly the staleness the
  // caller resolved before calling.
  const view = outcomeView(
    "failed",
    row({
      status: "running",
      error: "boom",
      startedAt: "2026-08-10T00:00:00.000Z",
      endedAt: "2026-08-10T00:00:01.000Z",
    }),
  );
  assertEquals(view, {
    status: "failed",
    error: "boom",
    startedAt: "2026-08-10T00:00:00.000Z",
    endedAt: "2026-08-10T00:00:01.000Z",
  });
});

Deno.test("absent detail is absent, not undefined-valued", () => {
  // `{ status }` and `{ status, error: undefined }` compare differently, and
  // the second would make `"error" in outcome` true for a target that succeeded.
  const view = outcomeView("succeeded", row());
  assertEquals(view, { status: "succeeded" });
  assertEquals("error" in view, false);
  assertEquals("startedAt" in view, false);
});

Deno.test("a record becomes one entry per settled target", () => {
  const all = outcomesFromRecord({
    unit: row({ status: "succeeded", endedAt: "t1" }),
    lint: row({ status: "failed", error: "nope" }),
    docs: row({ status: "skipped" }),
    gate: row({ status: "running" }),
    later: row({ status: "pending" }),
  });
  // `pending` is left out: a target that has not run has no outcome, and an
  // entry saying otherwise invites a body to branch on it.
  assertEquals([...all.keys()].sort(), ["docs", "gate", "lint", "unit"]);
  assertEquals(all.get("lint")?.error, "nope");
  assertEquals(all.get("unit")?.endedAt, "t1");
});

Deno.test("an empty record has no outcomes", () => {
  assertEquals(outcomesFromRecord({}).size, 0);
});
