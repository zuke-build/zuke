/**
 * Cross-run locks: the {@link LockHolder} identity, the typed
 * {@link LockConflictError}, the {@link lockKey} joiner, and the stored lock
 * record with its parser.
 *
 * A lock lets a target claim an exclusive resource across runs and processes —
 * "only one deploy of repo X at a time". The {@link "./store.ts".StateStore}
 * owns acquisition (atomic, with a TTL so a crashed holder cannot wedge it
 * forever); this module holds the value types they exchange.
 *
 * @module
 */

/** Who holds a lock — surfaced to the loser of a conflict so it can act. */
export interface LockHolder {
  /** The actor that acquired the lock. */
  actor: string;
  /** The run that holds it (`zuke cancel <runId>` releases it). */
  runId: string;
  /** ISO-8601 timestamp when it was acquired. */
  since: string;
  /** A link to the holding run (e.g. its CI job), when known. */
  runUrl?: string;
}

/**
 * Raised when a target's lock is already held by another run. Its `message` is
 * the rendered guidance (from the target's `onConflict`, else a default), so it
 * surfaces verbatim in the CLI failure footer and the run record; `holder`
 * carries the structured identity for programmatic surfaces (e.g. MCP).
 */
export class LockConflictError extends Error {
  /** The error name. */
  override name = "LockConflictError";
  /** Build the error from the current holder and the rendered guidance. */
  constructor(
    /** Who currently holds the contended lock. */
    readonly holder: LockHolder,
    /** The human-facing guidance shown to the loser. */
    guidance: string,
  ) {
    super(guidance);
  }
}

/**
 * Join parts into a lock key that is safe to use as a filename and URL segment.
 * Each part is sanitised (non-`[A-Za-z0-9._-]` runs become `_`) and empty parts
 * are dropped, so `lockKey("deploy", repo)` is stable and injection-free.
 */
export function lockKey(...parts: Array<string | number>): string {
  return parts
    .map((part) => String(part).replace(/[^A-Za-z0-9._-]+/g, "_"))
    .filter((part) => part.length > 0)
    .join("-");
}

/** A stored lock: its holder, the acquisition token, and its expiry. */
export interface LockRecord {
  /** The current holder's identity. */
  holder: LockHolder;
  /** The opaque token the holder proves ownership with (renew/release). */
  token: string;
  /** Epoch-millisecond expiry; a lock at or past this is free to take over. */
  expiresAt: number;
}

/** Narrow an unknown value to a plain object without casting, else `null`. */
function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) out[key] = val;
  return out;
}

/** Read a required string field, throwing a descriptive error otherwise. */
function str(object: Record<string, unknown>, field: string): string {
  const value = object[field];
  if (typeof value !== "string") {
    throw new Error(`state: lock field "${field}" is not a string`);
  }
  return value;
}

/** Parse and validate a {@link LockHolder} from an untrusted value. */
export function parseLockHolder(value: unknown): LockHolder {
  const object = asObject(value);
  if (object === null) throw new Error("state: lock holder is not an object");
  const runUrl = object.runUrl;
  if (runUrl !== undefined && typeof runUrl !== "string") {
    throw new Error(`state: lock field "runUrl" is not a string`);
  }
  const holder: LockHolder = {
    actor: str(object, "actor"),
    runId: str(object, "runId"),
    since: str(object, "since"),
  };
  if (runUrl !== undefined) holder.runUrl = runUrl;
  return holder;
}

/** Parse and validate a stored {@link LockRecord}. */
export function parseLockRecord(text: string): LockRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("state: lock record is not valid JSON");
  }
  const object = asObject(parsed);
  if (object === null) throw new Error("state: lock record is not an object");
  const expiresAt = object.expiresAt;
  if (typeof expiresAt !== "number") {
    throw new Error(`state: lock field "expiresAt" is not a number`);
  }
  return {
    holder: parseLockHolder(object.holder),
    token: str(object, "token"),
    expiresAt,
  };
}

/** Serialise a lock record to its stored form (pretty JSON + newline). */
export function stringifyLockRecord(record: LockRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
