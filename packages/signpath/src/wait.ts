// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Waiting for a signing request to finish: poll its status until it is final,
 * bounded by a deadline.
 *
 * The wait always ends. It polls, and returns on `Completed`; throws a
 * {@link SignPathSigningError} on any other final status; and otherwise sleeps
 * for the poll interval — or only what is left of the wait, so the last poll
 * lands on the deadline rather than past it — and throws a
 * {@link SignPathTimeoutError} once a poll at or after the deadline is still
 * not final. A transient failure of one poll is retried by the transport; a
 * lasting one ends the wait with its error.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import type { Connection } from "./connect.ts";
import { SignPathSigningError, SignPathTimeoutError } from "./errors.ts";
import { fetchStatus } from "./status.ts";
import type { SignPathSigningRequestStatus } from "./types.ts";

/** How long to wait, and how often to look. */
export interface WaitLimits {
  /** The longest wait, in ms. */
  readonly timeoutMs: number;
  /** The time between two polls, in ms. */
  readonly pollIntervalMs: number;
}

/** Wait for signing request `id` to complete; return its final status. */
export async function waitForCompletion(
  connection: Connection,
  id: string,
  limits: WaitLimits,
): Promise<SignPathSigningRequestStatus> {
  const { settings } = connection;
  const deadline = settings.now_() + limits.timeoutMs;
  let reported: string | undefined;
  for (;;) {
    const current = await fetchStatus(connection, id);
    if (current.status !== reported) {
      settings.log_(`SignPath: signing request ${id} is ${current.status}`);
      reported = current.status;
    }
    if (current.isFinalStatus) {
      if (current.status === "Completed") return current;
      throw new SignPathSigningError(
        id,
        current.status,
        current.workflowStatus,
        current.webUrl,
      );
    }
    const remaining = deadline - settings.now_();
    if (remaining <= 0) {
      throw new SignPathTimeoutError(
        id,
        current.status,
        limits.timeoutMs,
        current.webUrl,
      );
    }
    await settings.sleep_(Math.min(limits.pollIntervalMs, remaining));
  }
}
