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
 * Settle every target still parked on a gate, for a run that has reached a
 * terminal status. `skipped` is the vocabulary the scheduler already uses when
 * a failed run leaves a gate nobody will ever resume.
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
export function settleWaitingTargets(
  record: RunRecord,
  at: string,
  expired?: { target: string; message: string },
): void {
  for (const [name, row] of Object.entries(record.targets)) {
    if (row.status !== "waiting") continue;
    settleTargetRow(row, "skipped", at);
    if (name === expired?.target) row.error = expired.message;
  }
}
