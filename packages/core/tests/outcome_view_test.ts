// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the outcome views behind `ctx.outcomeOf(...)` — how a status
 * and a run-record row become the shape a target body reads.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { outcomesFromRecord, outcomeView } from "../src/run_support.ts";
import type { TargetRunState } from "../src/state/types.ts";
import { parseRunRecord } from "../src/state/types.ts";

/** A record row, with only the fields a case cares about set. */
function row(over: Partial<TargetRunState> = {}): TargetRunState {
  return { status: "succeeded", meta: {}, ...over };
}

Deno.test("a status with no record row is the whole view", () => {
  assertEquals(outcomeView({ status: "succeeded" }, undefined), {
    status: "succeeded",
  });
});

Deno.test("the row contributes its detail but never its status", () => {
  // The row is the durable copy and can be a write behind the status passed in,
  // so carrying `row.status` over would reintroduce exactly the staleness the
  // caller resolved before calling.
  const view = outcomeView(
    { status: "failed" },
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

Deno.test("the settlement carries the failure message when there is no record", () => {
  // No record row exists to read `error` from, so a run with no state store
  // would otherwise report *that* a target failed but never *why*.
  assertEquals(outcomeView({ status: "failed", error: "boom" }, undefined), {
    status: "failed",
    error: "boom",
  });
});

Deno.test("the settlement's message wins over the record's", () => {
  // Same reason its status does: the row can be a write behind.
  const view = outcomeView(
    { status: "failed", error: "this attempt" },
    row({ status: "failed", error: "a previous attempt" }),
  );
  assertEquals(view.error, "this attempt");
});

Deno.test("absent detail is absent, not undefined-valued", () => {
  // `{ status }` and `{ status, error: undefined }` compare differently, and
  // the second would make `"error" in outcome` true for a target that succeeded.
  const view = outcomeView({ status: "succeeded" }, row());
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

Deno.test("an effect record claiming zero attempts is refused", () => {
  // An armed effect has been attempted once by definition, and a zero would make
  // a genuine re-drive report itself as a first attempt. Records can come from
  // another writer, so the shape is checked rather than trusted.
  const bad = {
    status: "succeeded",
    meta: {},
    effects: {
      post: {
        status: "pending",
        intentAt: "2026-08-10T10:00:00.000Z",
        attempts: 0,
      },
    },
  };
  let message = "";
  try {
    parseRunRecord(JSON.stringify({
      id: "r",
      build: "B",
      rootTarget: "gate",
      status: "running",
      actor: "a",
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-10T10:00:00.000Z",
      graph: [],
      params: {},
      targets: { gate: bad },
      signals: {},
      events: [],
    }));
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message.includes("positive integer"), true, message);
});

Deno.test("the settlement's notes win, and the row's fill in after a resume", () => {
  const live = outcomeView(
    { status: "succeeded", summary: [{ key: "Tests", value: "3" }] },
    row({ summary: [{ key: "Tests", value: "2" }] }),
  );
  assertEquals(live.summary, [{ key: "Tests", value: "3" }]);
  const durable = outcomeView(
    { status: "succeeded" },
    row({ summary: [{ key: "Lines", value: "98.4%" }] }),
  );
  assertEquals(durable.summary, [{ key: "Lines", value: "98.4%" }]);
  assertEquals("summary" in outcomeView({ status: "succeeded" }, row()), false);
});
