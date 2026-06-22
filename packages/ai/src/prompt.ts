/**
 * Assemble the system + user prompt for an assessment. The editable prompt text
 * lives in `./prompts/` (subjects and templates); this file only wires them
 * together.
 *
 * @module
 */

import type { AssessmentType } from "./types.ts";
import { SUBJECTS } from "./prompts/subjects.ts";
import { systemPrompt, userPrompt } from "./prompts/templates.ts";

/** Assemble the system + user prompt for an assessment. */
export function buildPrompt(
  assessment: AssessmentType,
  criteria: string,
  diff: string,
): { system: string; user: string } {
  const generic = assessment === "generic";
  const subject = generic ? "the criteria below" : SUBJECTS[assessment];
  return {
    system: systemPrompt(subject),
    user: userPrompt(diff, generic ? criteria : undefined),
  };
}
