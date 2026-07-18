/**
 * The MCP audit log: a store-level, append-only trail of tool calls kept in a
 * single fixed-id run record, so it needs no new {@link
 * "../state/store.ts".StateStore} method — it rides the same CAS-append path as
 * any run record, through {@link "../state/writer.ts".RunStateWriter.appendEvent}.
 *
 * ponytail: reuses one run record as the audit stream, so it shows up in
 * `zuke runs list` (and `zuke runs show mcp-audit` prints the trail — handy) and
 * grows unbounded. Fine for the dev-grade filesystem backend. Upgrade path if it
 * grows large or a hosted operator wants it separate: a dedicated store-level
 * stream (a new StateStore method + an `/audit` REST resource) instead of a run
 * record.
 *
 * @module
 */

import type { Redactor } from "../redact.ts";
import type { RunRecord } from "../state/types.ts";
import type { StateStore } from "../state/store.ts";
import { RunStateWriter } from "../state/writer.ts";

/** The fixed run id under which the MCP audit trail is stored. */
export const AUDIT_RUN_ID = "mcp-audit";

/**
 * Open (or seed) the audit-log writer over `store`: adopt the existing audit
 * record at its current version, or create a fresh one. Callers append with
 * {@link "../state/writer.ts".RunStateWriter.appendEvent}; the writer serialises
 * appends and CAS-retries on cross-process conflict.
 */
export async function openAuditLog(
  store: StateStore,
  now: () => string,
  redactor: Redactor,
  warn?: (message: string) => void,
): Promise<RunStateWriter> {
  const existing = await store.getRun(AUDIT_RUN_ID);
  if (existing !== null) {
    return RunStateWriter.adopt(
      store,
      existing.record,
      existing.version,
      now,
      redactor,
      warn,
    );
  }
  const record: RunRecord = {
    id: AUDIT_RUN_ID,
    build: "(mcp)",
    rootTarget: "(audit)",
    status: "running",
    actor: "system",
    createdAt: now(),
    updatedAt: now(),
    graph: [],
    params: {},
    targets: {},
    signals: {},
    events: [],
  };
  return await RunStateWriter.open(store, record, now, redactor, warn);
}
