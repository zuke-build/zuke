/**
 * The wording of the fixer's system and user prompts. Edit the prose here to
 * change how the AI fixer is instructed; the assembly logic lives in
 * `../fixer.ts`.
 *
 * @module
 */

/** The context a fix prompt is built from. */
export interface FixContext {
  /** The name of the failed target. */
  target: string;
  /** The command line that failed, if known. */
  command?: string;
  /** The captured stderr (and any stdout tail) from the failure. */
  output: string;
  /** The working-tree diff, for context on what recently changed. */
  diff?: string;
  /** Project conventions (e.g. the contents of CLAUDE.md / AGENTS.md). */
  conventions?: string;
  /** Optional project-specific notes appended by the caller. */
  criteria?: string;
}

/** The system prompt: instructs the model and pins the JSON response shape. */
export function fixSystemPrompt(): string {
  return [
    `You are a precise senior engineer fixing a failed build step. A target's command failed; you are given its error output and the recent changes.`,
    ``,
    `How to fix:`,
    `- Find the minimal root cause and the smallest correct change that makes the command pass.`,
    `- Respect the project's existing conventions, style, and types. Do not introduce new dependencies or reformat unrelated code.`,
    `- Only edit files that are necessary. For each file you change, return its COMPLETE new contents — not a patch or a fragment.`,
    `- Never edit lockfiles, CI workflow files, or generated artifacts. Never weaken or delete tests to force a pass; fix the underlying cause.`,
    `- If you cannot determine a safe, confident fix, return an empty "edits" array and explain why in the diagnosis.`,
    ``,
    `Point to the exact code. For every problem, add a "locations" entry: the file, the 1-based line number(s) from the error output and diff, the OFFENDING SOURCE quoted VERBATIM (copy the exact characters, indentation included — do not paraphrase), and the suggested replacement ("suggestion": "" means delete those lines). Keep "diagnosis" to a single short sentence; the locations carry the detail.`,
    ``,
    `Respond with ONLY a JSON object — no prose, no Markdown, no code fences — matching: ` +
    `{"diagnosis": <one short sentence>, "rootCause": <one short sentence>, ` +
    `"confidence": <"low"|"medium"|"high">, ` +
    `"locations": [{"file": <repo-relative path>, "line": <integer>, "endLine": <integer or null>, "code": <exact offending source, verbatim>, "suggestion": <replacement source, or "" to delete>}], ` +
    `"edits": [{"path": <repo-relative path>, "content": <full new file contents>}]}.`,
  ].join("\n");
}

/** The user prompt: the failure context assembled into labelled sections. */
export function fixUserPrompt(context: FixContext): string {
  const parts: string[] = [`Failed target: ${context.target}`];
  if (context.command !== undefined && context.command !== "") {
    parts.push(`\nFailed command:\n${context.command}`);
  }
  parts.push(`\nError output:\n${context.output}`);
  if (context.conventions !== undefined && context.conventions !== "") {
    parts.push(`\nProject conventions:\n${context.conventions}`);
  }
  if (context.criteria !== undefined && context.criteria !== "") {
    parts.push(`\nAdditional notes:\n${context.criteria}`);
  }
  if (context.diff !== undefined && context.diff !== "") {
    parts.push(`\nRecent changes (working-tree diff):\n${context.diff}`);
  }
  return parts.join("\n");
}
