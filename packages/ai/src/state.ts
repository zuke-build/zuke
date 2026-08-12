/**
 * Durable finding state, carried across review runs inside the reviewer's own
 * PR comment — the memory that turns per-run findings into a discussion.
 *
 * The state is a small JSON document, base64-encoded inside a hidden HTML
 * comment (`<!-- zuke-ai-state:… -->`) appended to the reviewer's upserted PR
 * comment. Encoding it keeps the block inert in rendered Markdown and immune
 * to `-->` breakouts from finding titles or rationales. It is **only ever read
 * back from a comment verified as the reviewer's own** (see
 * `hosts/github.ts`), so a state block pasted into an attacker's comment is
 * never trusted.
 *
 * @module
 */

import type { Severity } from "./types.ts";
import { toSeverity } from "./severity.ts";
import { dig } from "./json.ts";

/**
 * The lifecycle status of a tracked finding.
 *
 * - `open` — reported and awaiting action.
 * - `upheld` — a maintainer contested it and the reviewer re-checked and kept
 *   it, with the rationale recorded.
 * - `dismissed` — a maintainer refuted it and the reviewer accepted the
 *   refutation; it stays recorded (and muted) instead of resurfacing.
 * - `fixed` — a previously open finding that no longer reproduces against the
 *   current diff: the reviewer re-assessed it and the issue is gone. Kept in
 *   the state (and listed in the report) so the PR's progress is visible; it
 *   flips back to `open` if a later round reports it again.
 */
export type FindingStatus = "open" | "upheld" | "dismissed" | "fixed";

/** One finding tracked across runs in the review state. */
export interface StoredFinding {
  /** The finding's stable fingerprint (see `findingFingerprint`). */
  id: string;
  /** The finding's title, kept so a dismissed finding stays identifiable. */
  title: string;
  /** The finding's severity. */
  severity: Severity;
  /** The finding's lifecycle status. */
  status: FindingStatus;
  /** The file the finding was attributed to, if any. */
  file?: string;
  /** Why the finding was dismissed or upheld, when adjudicated. */
  rationale?: string;
  /** The login of the maintainer whose rebuttal drove the adjudication. */
  author?: string;
}

/** The review state carried between runs. */
export interface ReviewState {
  /** Every finding the reviewer is tracking, by lifecycle status. */
  findings: StoredFinding[];
}

/** The hidden-block prefix the encoded state is stored under. */
const STATE_PREFIX = "zuke-ai-state:";

/** Encode bytes as base64 (dependency-free, chunked to bound the arg list). */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x1000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Decode base64 into bytes, or `undefined` when the input is not base64. */
function fromBase64(text: string): Uint8Array | undefined {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

/**
 * Render `state` as the hidden HTML-comment block appended to the reviewer's
 * PR comment. Base64 keeps the JSON inert in Markdown and breakout-proof.
 */
export function encodeState(state: ReviewState): string {
  const json = JSON.stringify(state);
  return `<!-- ${STATE_PREFIX}${toBase64(new TextEncoder().encode(json))} -->`;
}

/** Read one stored finding out of parsed JSON, or `undefined` if malformed. */
function toStoredFinding(item: unknown): StoredFinding | undefined {
  const id = dig(item, "id");
  const title = dig(item, "title");
  const status = dig(item, "status");
  const severity = toSeverity(dig(item, "severity"));
  if (typeof id !== "string" || typeof title !== "string") return undefined;
  if (
    status !== "open" && status !== "upheld" && status !== "dismissed" &&
    status !== "fixed"
  ) {
    return undefined;
  }
  const file = dig(item, "file");
  const rationale = dig(item, "rationale");
  const author = dig(item, "author");
  return {
    id,
    title,
    severity: severity ?? "low",
    status,
    ...(typeof file === "string" ? { file } : {}),
    ...(typeof rationale === "string" ? { rationale } : {}),
    ...(typeof author === "string" ? { author } : {}),
  };
}

/**
 * Extract and decode the state block from a comment `body`, best-effort:
 * a missing block, invalid base64, malformed JSON, or an unrecognised shape
 * yields `undefined` (a fresh start) rather than an error — state is an
 * optimisation, never a point of failure. Malformed entries are skipped
 * individually so one bad record doesn't discard the rest.
 */
export function decodeState(body: string): ReviewState | undefined {
  const match = body.match(
    new RegExp(`<!-- ${STATE_PREFIX}([A-Za-z0-9+/=]+) -->`),
  );
  if (match === null) return undefined;
  const bytes = fromBase64(match[1]);
  if (bytes === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  const raw = dig(parsed, "findings");
  if (!Array.isArray(raw)) return undefined;
  const findings: StoredFinding[] = [];
  for (const item of raw) {
    const finding = toStoredFinding(item);
    if (finding !== undefined) findings.push(finding);
  }
  return { findings };
}

/** The dismissed findings in `state`, keyed by fingerprint. */
export function dismissedOf(
  state: ReviewState | undefined,
): Map<string, StoredFinding> {
  const dismissed = new Map<string, StoredFinding>();
  for (const finding of state?.findings ?? []) {
    if (finding.status === "dismissed") dismissed.set(finding.id, finding);
  }
  return dismissed;
}

/**
 * The findings in `state` still awaiting action — `open` and `upheld` — keyed
 * by fingerprint. These are re-assessed against the next round's diff: one
 * that stops being reported moves to `fixed`.
 */
export function openOf(
  state: ReviewState | undefined,
): Map<string, StoredFinding> {
  const open = new Map<string, StoredFinding>();
  for (const finding of state?.findings ?? []) {
    if (finding.status === "open" || finding.status === "upheld") {
      open.set(finding.id, finding);
    }
  }
  return open;
}

/** The findings in `state` already marked `fixed`, keyed by fingerprint. */
export function fixedOf(
  state: ReviewState | undefined,
): Map<string, StoredFinding> {
  const fixed = new Map<string, StoredFinding>();
  for (const finding of state?.findings ?? []) {
    if (finding.status === "fixed") fixed.set(finding.id, finding);
  }
  return fixed;
}
