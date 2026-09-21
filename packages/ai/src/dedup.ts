// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Identity resolution for reworded findings.
 *
 * A finding's fingerprint is a hash of its kind, its normalised title, and its
 * file, so a **reworded title yields a fresh id** — and every stage that keys
 * on the id (sticky dismissal, rebuttal matching, the progress record) misses
 * it. The same false positive can then arrive round after round under new
 * names. This module maps a fresh fingerprint back onto an identity the review
 * state already holds: for free when an earlier round recorded the rewording as
 * an alias, otherwise by asking the model once per run.
 *
 * The pass may only **rename**. It never dismisses, refutes, or suppresses:
 * whatever decision is attached to the adopted identity was earned in an
 * earlier round by the two-key rule (a trusted rebuttal matched in code *and*
 * the adjudicator accepting it), or spoken by a maintainer outright. Every
 * restriction on what a rename may do — same file and a severity ceiling for
 * an identity the model earned, which statuses are eligible, refusing a
 * collision — is enforced here in code, before any pair reaches a prompt.
 *
 * @module
 */

import type { AssessmentFinding } from "./types.ts";
import type { StoredFinding } from "./state.ts";
import type { Verdict } from "./verdicts.ts";
import type { DedupPairNote } from "./prompts/templates.ts";
import { rank } from "./severity.ts";

/** The verdict vocabulary of the dedup pass. */
export const DEDUP_VERDICTS: string[] = ["same", "different"];

/**
 * Cap on candidate × prior comparisons sent in one dedup pass — the pass is a
 * cost-bounded optimisation, not an exhaustive search.
 */
export const MAX_DEDUP_PAIRS = 24;

/**
 * Cap on the earlier findings any one candidate is compared against — the
 * ones the model decided (fixed, refuted, still open). A prior a maintainer
 * decided is not counted against it: see {@link planDedup}.
 */
export const MAX_PRIORS_PER_CANDIDATE = 3;

/** The empty set of contested ids, for callers with no discussion round. */
const NO_CONTESTED: ReadonlySet<string> = new Set();

/** One candidate × prior comparison the dedup pass asks about. */
export interface DedupPair {
  /** The opaque label a verdict must echo back — minted here as `p1`, `p2`, …. */
  label: string;
  /** The finding this round reported under a fresh fingerprint. */
  candidate: AssessmentFinding;
  /** The state entry it may be a rewording of. */
  prior: StoredFinding;
}

/** The comparisons selected for one pass, and what the caps left out. */
export interface DedupPlan {
  /** The comparisons to ask about, in deterministic offer order. */
  pairs: DedupPair[];
  /** Eligible comparisons the caps dropped — `0` when everything fit. */
  dropped: number;
}

/** How a pass's verdicts resolved. */
export interface DedupMatches {
  /** Candidate fingerprint → the entry whose identity it adopts. */
  matches: Map<string, StoredFinding>;
  /** Candidate fingerprints the model matched to more than one earlier finding. */
  ambiguous: string[];
}

/** One identity adoption performed by {@link adoptCanonicalIds}. */
export interface Adoption {
  /** The fresh fingerprint the finding arrived with — recorded as the alias. */
  alias: string;
  /** The state entry whose identity the finding took over. */
  prior: StoredFinding;
}

/** What one round of identity resolution produced. */
export interface RewordResult {
  /** Canonical id → the earlier title the finding now reported restates. */
  rewordedFrom: Map<string, string>;
  /** Canonical id → the fresh fingerprint to record as an alias. */
  newAliases: Map<string, string>;
  /** Operational notes (a cap, a skip, a failure, a reopen) for the report. */
  notes: string[];
}

/**
 * Serialise a plan's pairs for the prompt. Only the files and the two findings'
 * text travel: no ids, no severities, and above all no lifecycle status — the
 * model is never told that the earlier finding was dismissed, which would be a
 * thumb on the scale toward the answer that silences a finding. Text is
 * bounded so a verbose detail cannot crowd the pass.
 */
export function dedupNotes(plan: DedupPlan): DedupPairNote[] {
  return plan.pairs.map((pair) => ({
    label: pair.label,
    file: pair.candidate.file ?? "",
    title: clip(pair.candidate.title, TITLE_LIMIT),
    ...(pair.candidate.detail !== undefined
      ? { detail: clip(pair.candidate.detail, DETAIL_LIMIT) }
      : {}),
    priorTitle: clip(pair.prior.title, TITLE_LIMIT),
    ...(pair.prior.file !== undefined && pair.prior.file !== pair.candidate.file
      ? { priorFile: pair.prior.file }
      : {}),
  }));
}

/** Character cap on a title carried into the dedup prompt. */
const TITLE_LIMIT = 240;

/** Character cap on a detail carried into the dedup prompt. */
const DETAIL_LIMIT = 480;

/** Cut `text` to `limit` characters, marking it when anything was dropped. */
function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/**
 * Whether `prior` carries a **maintainer's** decision rather than the model's:
 * a finding dismissed or accepted through the discussion, or one still open
 * that a maintainer has contested this round. Such an identity may be adopted
 * across the files of the diff and at any severity — the maintainer decided
 * the concern, not its label or the line it was pinned to. This is what stops
 * the loop in which a dismissed concern comes back on another file of the
 * same change, or one severity up, under a fresh id every round.
 *
 * The model's own decisions (`fixed`, `refuted`) and its still-open findings
 * keep the tighter rules in {@link eligible}.
 */
export function decidedByMaintainer(
  prior: StoredFinding,
  contested: ReadonlySet<string>,
): boolean {
  return prior.status === "dismissed" || prior.status === "accepted" ||
    contested.has(prior.id);
}

/**
 * Whether a candidate may inherit `prior`'s identity at all. Two gates for an
 * identity the model earned, both in code so no prompt wording can widen
 * them:
 *
 * - **Same file.** A rewording restates one concern in one place; without this
 *   a refutation in one file could silence a finding in another.
 * - **Severity ceiling.** The candidate must be no more severe than the entry
 *   whose decision it would inherit, so a refuted `low` nit cannot launder a
 *   `critical` into silence.
 *
 * Neither gate applies to a prior a maintainer decided
 * ({@link decidedByMaintainer}): a dismissal already needed a trusted rebuttal
 * matched in code and the adjudicator's agreement, an acceptance was spoken
 * by a maintainer with push access, and the model's "same" verdict is still
 * required — so the two-key rule holds, and the concern stays decided however
 * the model reframes it.
 *
 * Both resolution paths run through this, the free one included: a fingerprint
 * pins the kind, title and file but **not the severity**, so the same wording
 * can return more severe than the decision an alias points at. Checking only
 * where a model is consulted would leave the cheap path — the steady state —
 * as the weaker one.
 */
export function eligible(
  candidate: AssessmentFinding,
  prior: StoredFinding,
  contested: ReadonlySet<string> = NO_CONTESTED,
): boolean {
  if (decidedByMaintainer(prior, contested)) return true;
  if (candidate.file === undefined || prior.file === undefined) return false;
  if (candidate.file !== prior.file) return false;
  return rank(candidate.severity) <= rank(prior.severity);
}

/**
 * Select the comparisons for one dedup pass, in a deterministic order derived
 * only from the order of the inputs — so an unchanged review produces an
 * unchanged plan, and neither the report nor the state block churns.
 *
 * Pairs are emitted **round-robin by depth**: every candidate's first
 * comparison is offered before any candidate's second. The caps therefore drop
 * the least-promising comparisons first and can never starve one candidate by
 * spending the whole budget on another.
 *
 * A prior a maintainer decided ({@link decidedByMaintainer}) is offered
 * **first** for every candidate, and outside the per-candidate cap: those are
 * the comparisons that end a loop, and the caps exist to bound the model's
 * own restatements, not to drop a maintainer's decision for budget. Only the
 * pass-wide cap still bounds them.
 */
export function planDedup(
  candidates: readonly AssessmentFinding[],
  priors: readonly StoredFinding[],
  contested: ReadonlySet<string> = NO_CONTESTED,
  maxPairs: number = MAX_DEDUP_PAIRS,
  maxPerCandidate: number = MAX_PRIORS_PER_CANDIDATE,
): DedupPlan {
  const byCandidate: Array<
    Array<{ candidate: AssessmentFinding; prior: StoredFinding }>
  > = [];
  let eligibleCount = 0;
  for (const candidate of candidates) {
    if (candidate.id === undefined || candidate.id === "") continue;
    const matches = priors
      .filter((prior) => eligible(candidate, prior, contested))
      .map((prior) => ({ candidate, prior }));
    eligibleCount += matches.length;
    const decided = matches.filter((m) =>
      decidedByMaintainer(m.prior, contested)
    );
    const earned = matches
      .filter((m) => !decidedByMaintainer(m.prior, contested))
      .slice(0, maxPerCandidate);
    const offered = [...decided, ...earned];
    if (offered.length > 0) byCandidate.push(offered);
  }
  const pairs: DedupPair[] = [];
  const depth = byCandidate.reduce(
    (most, list) => Math.max(most, list.length),
    0,
  );
  for (let level = 0; level < depth && pairs.length < maxPairs; level++) {
    for (const list of byCandidate) {
      if (pairs.length === maxPairs) break;
      const entry = list[level];
      if (entry === undefined) continue;
      pairs.push({ label: `p${pairs.length + 1}`, ...entry });
    }
  }
  return { pairs, dropped: eligibleCount - pairs.length };
}

/**
 * The note announcing which comparisons the caps left out, or `undefined` when
 * everything eligible was compared. A bounded pass that says nothing reads as
 * "nothing matched" when it means "not everything was checked".
 */
export function dedupCapNote(plan: DedupPlan): string | undefined {
  if (plan.dropped === 0) return undefined;
  return `reworded-finding check compared ${plan.pairs.length} of ` +
    `${plan.pairs.length + plan.dropped} candidate pairs (cap ` +
    `${MAX_DEDUP_PAIRS}) — an unchecked pair keeps its own identity`;
}

/**
 * Resolve a pass's verdicts into the identities to adopt.
 *
 * The pair is recovered by **looking the label up** among the pairs we offered,
 * never by parsing it: a verdict naming a label we did not mint — or a
 * fabricated composite of two ids — matches nothing and is inert. A pair with
 * no verdict, or any verdict other than `same`, leaves the candidate with its
 * own identity, so the pass fails toward reporting the finding.
 *
 * First offered wins when a candidate is matched to several earlier findings,
 * and the extra matches are reported as `ambiguous` rather than silently
 * resolved. A prior may be adopted only once per round, so two distinct
 * findings can never collapse onto one identity.
 */
export function sameAs(
  plan: DedupPlan,
  verdicts: Map<string, Verdict>,
): DedupMatches {
  const matches = new Map<string, StoredFinding>();
  const ambiguous: string[] = [];
  const claimed = new Set<string>();
  const decided = new Set<string>();
  for (const pair of plan.pairs) {
    if (verdicts.get(pair.label)?.verdict !== "same") continue;
    const id = pair.candidate.id ?? "";
    if (id === "") continue;
    // The FIRST match decides a candidate, whether or not it can be honoured.
    // Letting a candidate fall through to its next match would quietly demote
    // it: pairs are offered in a deliberate order — a maintainer's decision
    // first, then a fixed entry ahead of the model's own refutations — and a
    // second choice would reverse that whenever the first prior was taken.
    if (decided.has(id)) {
      if (!ambiguous.includes(id)) ambiguous.push(id);
      continue;
    }
    decided.add(id);
    if (claimed.has(pair.prior.id)) continue;
    matches.set(id, pair.prior);
    claimed.add(pair.prior.id);
  }
  return { matches, ambiguous };
}

/**
 * Rewrite each matched finding's id to the identity it restates, and report the
 * adoptions so the aliases can be recorded. This is the only mutation the whole
 * pass performs.
 *
 * An adoption is **refused** when another finding this round already holds the
 * target id: two findings sharing one identity would collapse into a single
 * state entry, render as one row, and let a single rebuttal dismiss both. The
 * refused finding simply keeps its own fresh fingerprint and is reported.
 */
export function adoptCanonicalIds(
  findings: readonly AssessmentFinding[],
  matches: Map<string, StoredFinding>,
): Adoption[] {
  const taken = new Set<string>();
  for (const finding of findings) {
    if (finding.id !== undefined && !matches.has(finding.id)) {
      taken.add(finding.id);
    }
  }
  const adoptions: Adoption[] = [];
  for (const finding of findings) {
    const alias = finding.id;
    if (alias === undefined) continue;
    const prior = matches.get(alias);
    if (prior === undefined || taken.has(prior.id)) continue;
    finding.id = prior.id;
    taken.add(prior.id);
    adoptions.push({ alias, prior });
  }
  return adoptions;
}
