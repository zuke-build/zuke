// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The MCP audit log: a store-level, append-only trail of tool calls kept in a
 * single fixed-id run record, so it needs no new {@link
 * "../state/store.ts".StateStore} method — it rides the same CAS-append path as
 * any run record, through {@link "../state/writer.ts".RunStateWriter.appendEvent}.
 *
 * caveat: reuses one run record as the audit stream, so it shows up in
 * `zuke runs list` (and `zuke runs show mcp-audit` prints the trail — handy) and
 * grows unbounded. Fine for the dev-grade filesystem backend. Upgrade path if it
 * grows large or a hosted operator wants it separate: a dedicated store-level
 * stream (a new StateStore method + an `/audit` REST resource) instead of a run
 * record.
 *
 * @module
 */

import { Redactor } from "../redact.ts";
import type { RunEvent, RunRecord } from "../state/types.ts";
import type { StateStore } from "../state/store.ts";
import { RunStateWriter } from "../state/writer.ts";

/** The fixed run id under which the MCP audit trail is stored. */
export const AUDIT_RUN_ID = "mcp-audit";

/** Control keys whose values are always safe to record (booleans, never secrets). */
export const AUDIT_SAFE_KEYS: ReadonlySet<string> = new Set([
  "dryRun",
  "confirm",
]);

/**
 * The string form an argument takes in the audit trail: a structure is
 * serialised, everything else stringified. Used both to seed a redactor and to
 * render the recorded value, so the two can never disagree about what text a
 * value produces.
 */
export function auditText(value: unknown): string {
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value);
}

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

/**
 * A lazily-opened handle on the audit trail: {@link AuditTrail.append} opens the
 * writer on the first event and reuses it after.
 *
 * The open is memoised as a **promise**, so two concurrent first calls share one
 * writer (whose internal chain serialises appends) rather than racing to create
 * two; a failed open is dropped, so a later call retries instead of reusing a
 * poisoned one. Appending is best-effort — a store hiccup must never fail the
 * tool call being audited — so every failure is swallowed.
 */
export class AuditTrail {
  /** The store the trail is written to. */
  readonly #store: StateStore;
  /** The audit writer, memoised as a promise from the first append. */
  #writer?: Promise<RunStateWriter>;

  /** Build the trail over `store`; nothing is opened until the first append. */
  constructor(store: StateStore) {
    this.#store = store;
  }

  /** Append one event to the trail, best-effort. */
  async append(event: RunEvent): Promise<void> {
    try {
      this.#writer ??= openAuditLog(
        this.#store,
        () => new Date().toISOString(),
        new Redactor(),
      );
      await (await this.#writer).appendEvent(event);
    } catch {
      // Auditing is best-effort: a store hiccup must not fail the tool call.
      // Drop a failed open so a later call can retry instead of a poisoned one.
      this.#writer = undefined;
    }
  }
}
