// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: settling one target row. The rule the three call sites share is that a
 * settled target is no longer parked on a gate, so the wait goes with the
 * status — see `packages/core/src/state/settle.ts`.
 */

import { assertEquals } from "./_assert.ts";
import {
  settleTargetRow,
  settleUnreachedTargets,
} from "../src/state/settle.ts";
import { runRecord } from "./_fakes.ts";
import type { TargetRunState } from "../src/state/types.ts";

/** A target row parked on a signal gate with an hour left on its deadline. */
function waitingRow(): TargetRunState {
  return {
    status: "waiting",
    meta: {},
    startedAt: "2026-09-08T10:00:00.000Z",
    waitingFor: {
      trigger: "signal:approved",
      onTimeout: "fail",
      deadline: "2026-09-08T11:00:00.000Z",
    },
  };
}

Deno.test("settling a waiting row drops the wait it is no longer on", () => {
  const row = waitingRow();
  settleTargetRow(row, "failed", "2026-09-08T10:30:00.000Z");
  assertEquals(row.status, "failed");
  assertEquals(row.endedAt, "2026-09-08T10:30:00.000Z");
  assertEquals(row.waitingFor, undefined);
  // The field is removed, not set to undefined: it is optional on the contract,
  // and `JSON.stringify` would otherwise still omit it while `in` reported it.
  assertEquals("waitingFor" in row, false);
});

Deno.test("settling leaves everything the row already recorded", () => {
  const row = waitingRow();
  row.meta = { slot: "sit-7" };
  settleTargetRow(row, "skipped", "2026-09-08T10:30:00.000Z");
  assertEquals(row.meta, { slot: "sit-7" });
  assertEquals(row.startedAt, "2026-09-08T10:00:00.000Z");
  assertEquals(row.status, "skipped");
});

Deno.test("settling a row that never waited is just the status and the time", () => {
  const row: TargetRunState = { status: "running", meta: {} };
  settleTargetRow(row, "succeeded", "2026-09-08T10:30:00.000Z");
  assertEquals(row.status, "succeeded");
  assertEquals(row.endedAt, "2026-09-08T10:30:00.000Z");
  assertEquals("waitingFor" in row, false);
});

Deno.test("the sweep settles only the rows still parked on a gate", () => {
  const record = runRecord({
    id: "r1",
    rootTarget: "root",
    status: "cancelled",
    targets: {
      built: {
        status: "succeeded",
        meta: {},
        endedAt: "2026-09-08T10:00:00.000Z",
      },
      gate: waitingRow(),
      later: { status: "pending", meta: {} },
    },
  });
  settleUnreachedTargets(record, "2026-09-08T10:30:00.000Z");
  assertEquals(record.targets.gate.status, "skipped");
  assertEquals(record.targets.gate.waitingFor, undefined);
  // A target that already settled keeps its own outcome and its own endedAt.
  assertEquals(record.targets.built.status, "succeeded");
  assertEquals(record.targets.built.endedAt, "2026-09-08T10:00:00.000Z");
  // One the run never reached settles as well — a terminal run will not get
  // to it, and the scheduler already says `skipped` for exactly this case.
  assertEquals(record.targets.later.status, "skipped");
  assertEquals(typeof record.targets.later.endedAt, "string");
});

Deno.test("the sweep records why, when a deadline is what cancelled the run", () => {
  const record = runRecord({
    id: "r1",
    rootTarget: "gate",
    status: "cancelled",
    targets: { gate: waitingRow(), other: waitingRow() },
  });
  settleUnreachedTargets(record, "2026-09-08T10:30:00.000Z", {
    target: "gate",
    message: 'wait "gate" timed out (deadline 2026-09-08T11:00:00.000Z)',
  });
  // Without this the record could not tell a missed deadline from an operator
  // typing `zuke cancel` — the `fail` disposition records one, so this must too.
  assertEquals(
    record.targets.gate.error,
    'wait "gate" timed out (deadline 2026-09-08T11:00:00.000Z)',
  );
  // Only the wait that expired is named; another parked gate just settles.
  assertEquals(record.targets.other.status, "skipped");
  assertEquals(record.targets.other.error, undefined);
});
