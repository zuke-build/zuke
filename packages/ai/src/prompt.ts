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

/**
 * Assemble the system + user prompt for an assessment. The subject of the
 * review (security, code quality, …) is fixed in the system prompt by the
 * assessment kind; `criteria` is optional **project-specific fine-tuning** that
 * is appended to the user prompt above the diff. Any reviewer may pass it; the
 * default subject already gives the model what it needs to score without it.
 */
export function buildPrompt(
  assessment: AssessmentType,
  criteria: string,
  diff: string,
): { system: string; user: string } {
  return {
    system: systemPrompt(SUBJECTS[assessment]),
    user: userPrompt(diff, criteria === "" ? undefined : criteria),
  };
}
