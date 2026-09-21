// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
 * - `accepted` — a maintainer accepted it as intended for this pull request
 *   with the `accept` command, no adjudication asked: the concern is decided,
 *   and it stays recorded (and muted) exactly like a dismissal.
 * - `fixed` — a previously open finding that no longer reproduces against the
 *   current diff: the reviewer re-assessed it and the issue is gone. Kept in
 *   the state (and listed in the report) so the PR's progress is visible; it
 *   flips back to `open` if a later round reports it again.
 * - `refuted` — the verify pass disproved it against the code, with the
 *   evidence recorded as the rationale and everything the verifier saw
 *   fingerprinted in {@link StoredFinding.evidence}. Remembered so the next
 *   round neither re-raises it nor judges it afresh: while that input is
 *   unchanged the refutation stands without another call, and once anything in
 *   it changes the verifier sees the earlier evidence before deciding again. It
 *   flips to `open` if a later round confirms it against the changed code.
 */
export type FindingStatus =
  | "open"
  | "upheld"
  | "dismissed"
  | "accepted"
  | "fixed"
  | "refuted";

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
  /** Why the finding was dismissed, accepted or upheld, when decided. */
  rationale?: string;
  /**
   * The login of the maintainer whose rebuttal drove the adjudication, or who
   * accepted the finding.
   */
  author?: string;
  /**
   * For a `refuted` finding: the SHA-256 digest of everything the verifier
   * saw when it refuted — the whole reviewed diff and the file context, not
   * just the finding's own file, because the evidence a refutation cites may
   * live anywhere in that input. A later round whose input digests the same
   * knows the evidence cannot have changed, and keeps the refutation without
   * asking again; any other input sends the finding back to the verifier.
   */
  evidence?: string;
  /**
   * Fingerprints of earlier **rewordings** of this same finding — the ids it
   * arrived under when the model restated it in different words. Recording one
   * makes the next round's match free: the id is recognised outright instead of
   * costing a dedup call. Bounded by {@link MAX_ALIASES}, newest first.
   */
  aliases?: string[];
}

/** The review state carried between runs. */
export interface ReviewState {
  /** Every finding the reviewer is tracking, by lifecycle status. */
  findings: StoredFinding[];
}

/** The hidden-block prefix the encoded state is stored under. */
const STATE_PREFIX = "zuke-ai-state:";

/**
 * Cap on the rewording fingerprints kept per finding. The state block rides
 * inside a PR comment, so it must not grow without bound as a model restates
 * the same finding round after round; the newest aliases are the ones a future
 * round is likely to see again.
 */
export const MAX_ALIASES = 5;

/**
 * Whether `value` is shaped like an evidence digest — the lowercase hex of a
 * SHA-256. Compared for equality only, so a malformed one costs at most one
 * re-verification; it is still held to the digest alphabet so the state block
 * can never carry arbitrary text under that key.
 */
function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Whether `value` is shaped like a fingerprint — the lowercase base-36 token
 * {@link "./hash.ts".stableHash} produces (13 characters for its 64 bits).
 * Anything else in an `aliases` list is a malformed or hand-edited record and
 * is dropped, so an alias can never carry arbitrary text into a later round's
 * lookups.
 */
function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-z]{1,16}$/.test(value);
}

/**
 * The validated alias list for a stored finding: well-formed fingerprints
 * only, de-duplicated, never the entry's own id, capped at
 * {@link MAX_ALIASES}. `newest` is prepended, so a fresh rewording survives
 * the cap and the oldest is the one dropped.
 */
export function mergeAliases(
  existing: readonly string[] | undefined,
  newest: readonly string[],
  ownId: string,
): string[] {
  const merged: string[] = [];
  for (const alias of [...newest, ...(existing ?? [])]) {
    if (!isFingerprint(alias) || alias === ownId) continue;
    if (merged.includes(alias)) continue;
    merged.push(alias);
    if (merged.length === MAX_ALIASES) break;
  }
  return merged;
}

/**
 * Every recorded alias in `state`, mapped to the finding that owns it — the
 * free half of reword resolution: a fingerprint found here is recognised
 * outright, with no model call.
 *
 * An alias that collides with a real finding's id is dropped: a stored
 * identity always outranks a claim to be a rewording of one, so a malformed or
 * stale record can never shadow a live finding.
 */
export function aliasIndex(
  state: ReviewState | undefined,
): Map<string, StoredFinding> {
  const findings = state?.findings ?? [];
  const ids = new Set(findings.map((finding) => finding.id));
  const index = new Map<string, StoredFinding>();
  for (const finding of findings) {
    for (const alias of finding.aliases ?? []) {
      if (ids.has(alias) || index.has(alias)) continue;
      index.set(alias, finding);
    }
  }
  return index;
}

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
    status !== "accepted" && status !== "fixed" && status !== "refuted"
  ) {
    return undefined;
  }
  const file = dig(item, "file");
  const rationale = dig(item, "rationale");
  const author = dig(item, "author");
  const evidence = dig(item, "evidence");
  // Best-effort like every other field: a malformed alias list yields no
  // aliases rather than discarding the record, so a bad entry costs at most one
  // dedup call — never the dismissal the finding already earned.
  const raw = dig(item, "aliases");
  const aliases = mergeAliases(
    Array.isArray(raw) ? raw.filter(isFingerprint) : [],
    [],
    id,
  );
  return {
    id,
    title,
    severity: severity ?? "low",
    status,
    ...(typeof file === "string" ? { file } : {}),
    ...(typeof rationale === "string" ? { rationale } : {}),
    ...(typeof author === "string" ? { author } : {}),
    ...(isDigest(evidence) ? { evidence } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
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
  // The LAST block wins. The reviewer appends its own block after the report it
  // just rendered, and that report repeats model output — so anything a finding
  // title managed to smuggle in appears earlier in the body. Reading the first
  // match would let such a block outrank the reviewer's own. This is defence in
  // depth: the renderer neutralises those delimiters (see `report.ts`'s `cell`),
  // and neither layer is relied on alone.
  const matches = [
    ...body.matchAll(
      new RegExp(`<!-- ${STATE_PREFIX}([A-Za-z0-9+/=]+) -->`, "g"),
    ),
  ];
  const match = matches.at(-1);
  if (match === undefined) return undefined;
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

/** The findings in `state` carrying any of `statuses`, keyed by fingerprint. */
function byStatus(
  state: ReviewState | undefined,
  ...statuses: FindingStatus[]
): Map<string, StoredFinding> {
  const matched = new Map<string, StoredFinding>();
  for (const finding of state?.findings ?? []) {
    if (statuses.includes(finding.status)) matched.set(finding.id, finding);
  }
  return matched;
}

/**
 * The findings in `state` a maintainer's decision muted — `dismissed` through
 * adjudication or `accepted` outright — keyed by fingerprint. Both are sticky,
 * both are shown to the model as decided, and both are priors a restatement
 * inherits whatever file or severity it comes back under.
 */
export function dismissedOf(
  state: ReviewState | undefined,
): Map<string, StoredFinding> {
  return byStatus(state, "dismissed", "accepted");
}

/**
 * The findings in `state` still awaiting action — `open` and `upheld` — keyed
 * by fingerprint. These are re-assessed against the next round's diff: one
 * that stops being reported moves to `fixed`.
 */
export function openOf(
  state: ReviewState | undefined,
): Map<string, StoredFinding> {
  return byStatus(state, "open", "upheld");
}

/** The findings in `state` already marked `fixed`, keyed by fingerprint. */
export function fixedOf(
  state: ReviewState | undefined,
): Map<string, StoredFinding> {
  return byStatus(state, "fixed");
}

/**
 * The findings in `state` the verify pass refuted in an earlier round, keyed
 * by fingerprint — each carrying the evidence it was refuted on and the digest
 * of the input that evidence was read from.
 */
export function refutedOf(
  state: ReviewState | undefined,
): Map<string, StoredFinding> {
  return byStatus(state, "refuted");
}
