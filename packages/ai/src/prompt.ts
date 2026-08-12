/**
 * Assemble the system + user prompt for an assessment. The editable prompt text
 * lives in `./prompts/` (subjects and templates); this file only wires them
 * together.
 *
 * @module
 */

import type { AssessmentType } from "./types.ts";
import { SUBJECTS } from "./prompts/subjects.ts";
import {
  adjudicateSystemPrompt,
  adjudicateUserPrompt,
  type DedupPairNote,
  dedupSystemPrompt,
  dedupUserPrompt,
  type PromptExtras,
  type RebuttalNote,
  systemPrompt,
  userPrompt,
  type VerifyCandidate,
  verifySystemPrompt,
  verifyUserPrompt,
} from "./prompts/templates.ts";

/**
 * Assemble the system + user prompt for an assessment. The subject of the
 * review (security, code quality, …) is fixed in the system prompt by the
 * assessment kind; `criteria` is optional **project-specific fine-tuning** that
 * is appended to the user prompt above the diff. Any reviewer may pass it; the
 * default subject already gives the model what it needs to score without it.
 * `extras` adds the fenced context blocks (conventions, file contents,
 * dismissed findings) described on {@link PromptExtras}.
 */
export function buildPrompt(
  assessment: AssessmentType,
  criteria: string,
  diff: string,
  extras: PromptExtras = {},
): { system: string; user: string } {
  return {
    system: systemPrompt(SUBJECTS[assessment], extras),
    user: userPrompt(diff, criteria === "" ? undefined : criteria, extras),
  };
}

/**
 * Assemble the verify-pass prompt: adversarially re-check `candidates` against
 * the diff (and the file contents in `extras`, when present).
 */
export function buildVerifyPrompt(
  assessment: AssessmentType,
  candidates: VerifyCandidate[],
  diff: string,
  extras: PromptExtras = {},
): { system: string; user: string } {
  return {
    system: verifySystemPrompt(SUBJECTS[assessment]),
    user: verifyUserPrompt(candidates, diff, extras),
  };
}

/**
 * Assemble the adjudication-pass prompt: weigh each maintainer rebuttal
 * against the finding it contests.
 */
export function buildAdjudicatePrompt(
  assessment: AssessmentType,
  rebuttals: RebuttalNote[],
  diff: string,
): { system: string; user: string } {
  return {
    system: adjudicateSystemPrompt(SUBJECTS[assessment]),
    user: adjudicateUserPrompt(rebuttals, diff),
  };
}

/**
 * Assemble the dedup-pass prompt: decide, per labelled pair, whether a finding
 * this round restates one the review state already holds. Deliberately carries
 * no diff — identity is a text question, and every extra byte of untrusted
 * context is injection surface bought for nothing.
 */
export function buildDedupPrompt(
  assessment: AssessmentType,
  pairs: DedupPairNote[],
): { system: string; user: string } {
  return {
    system: dedupSystemPrompt(SUBJECTS[assessment]),
    user: dedupUserPrompt(pairs),
  };
}
