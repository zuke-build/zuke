/**
 * The wording of the system and user prompts. Edit the prose here to change how
 * reviewers are instructed — the assembly logic lives in `../prompt.ts`.
 *
 * @module
 */

/** The system prompt: instructs the model and pins the JSON response shape. */
export function systemPrompt(subject: string): string {
  return `You are a meticulous senior reviewer. Assess the unified diff for ${subject}. ` +
    `Respond with ONLY a JSON object — no prose, no Markdown, no code fences — matching: ` +
    `{"score": <integer 0-10, higher means more risk>, "severity": <"none"|"low"|"medium"|"high"|"critical">, ` +
    `"summary": <one sentence>, "findings": [{"title": <string>, "severity": <severity>, "file": <string?>, "line": <number?>, "detail": <string?>}]}. ` +
    `If there is nothing of concern, return score 0, severity "none", and an empty findings array.`;
}

/** The user prompt: optional review criteria followed by the diff to review. */
export function userPrompt(diff: string, criteria?: string): string {
  const preamble = criteria !== undefined
    ? `Review criteria:\n${criteria}\n\n`
    : "";
  return `${preamble}Unified diff to review:\n\n${diff}`;
}
