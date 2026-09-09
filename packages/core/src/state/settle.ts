// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settling one target row of a {@link "./types.ts".RunRecord}.
 *
 * Three call sites settle a target: the writer's ordinary path, the resume that
 * fails a timed-out wait, and the cancellation that finalizes a run. Each has to
 * remember that a settled target is no longer parked on a gate, and two of them
 * did not — a timed-out target kept the wait it had just given up on, and a
 * cancelled run kept a target still claiming to be waiting. The rule lives here
 * so there is one implementation to forget.
 *
 * @module
 */

import type { RunRecord, TargetRunState, TargetRunStatus } from "./types.ts";

/**
 * Record `row`'s terminal status: the status itself, the instant it ended, and
 * the removal of the wait it is no longer on.
 *
 * Dropping `waitingFor` is the part every caller has forgotten at least once.
 * It is what a reader — `zuke runs show`, an exporter, any consumer of the
 * state contract — uses to decide the target is parked on a gate, and it
 * carries a deadline that has stopped meaning anything the moment the target
 * settles.
 */
export function settleTargetRow(
  row: TargetRunState,
  status: TargetRunStatus,
  at: string,
): void {
  row.status = status;
  row.endedAt = at;
  delete row.waitingFor;
}

/**
 * Settle every target a run that has reached a terminal status will never
 * reach: the ones still parked on a gate, and the ones it never started.
 * `skipped` is the vocabulary the scheduler already uses for both.
 *
 * `pending` earns its place on a **suspended** record, where it means "a resume
 * will run this". On a terminal one it means nothing a reader can act on, and
 * no sweep will ever revisit it — which is the scheduler's own stated reason
 * for settling those rows when a run fails outright. Applying it here is what
 * makes the three terminal paths agree: before this, a run that failed said
 * `skipped` while a run that failed *by timing out* said `pending`.
 *
 * Both cancellation paths call this **after** their compensation walk, and that
 * order is load-bearing: the walk treats a `waiting` target as unproven and
 * compensates it, where a settled one it does not. Sweeping first would quietly
 * stop unwinding parked gates.
 *
 * `expired` names the wait whose deadline caused the cancellation, when one
 * did. Without it a `cancel-run` timeout would settle the gate indistinguishably
 * from one an operator cancelled by hand, and the terminal record would no
 * longer say a deadline was missed — which the `fail` disposition does record.
 */
export function settleUnreachedTargets(
  record: RunRecord,
  at: string,
  expired?: { target: string; message: string },
): void {
  for (const row of Object.values(record.targets)) {
    if (row.status === "waiting" || row.status === "pending") {
      settleTargetRow(row, "skipped", at);
    }
  }
  if (expired === undefined) return;
  // Looked up, not matched by name while sweeping: the reason belongs to the
  // run, so recording it does not depend on catching that row mid-sweep. A
  // caller naming a target the record does not have gets nothing rather than a
  // throw — a cancellation is the wrong moment to fail over a diagnostic.
  const row = record.targets[expired.target];
  if (row !== undefined) row.error = expired.message;
}
