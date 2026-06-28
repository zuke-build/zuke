/**
 * The prompt handed to a coding agent (Claude/Codex/Gemini) by the {@link
 * "../agent_fixer.ts".AgentFixer}. The agent reads files and edits them itself,
 * so the prompt frames the failure and the task rather than asking for
 * structured output.
 *
 * @module
 */

/** The failure context a fix prompt is built from. */
export interface AgentPromptContext {
  /** The name of the failed target. */
  target: string;
  /** The command line that failed, if known. */
  command?: string;
  /** The captured error output. */
  output: string;
  /** Project conventions (e.g. the contents of CLAUDE.md / AGENTS.md). */
  conventions?: string;
  /** Optional project-specific notes appended by the caller. */
  criteria?: string;
}

/** Assemble the instruction handed to the coding agent. */
export function agentPrompt(context: AgentPromptContext): string {
  const parts = [
    `A build target failed and you are fixing it. Investigate the relevant ` +
    `files, make the smallest correct change so the command passes, and stop. ` +
    `Respect the project's existing conventions and types; do not introduce ` +
    `new dependencies, reformat unrelated code, or weaken or delete tests to ` +
    `force a pass — fix the underlying cause.`,
    ``,
    `Failed target: ${context.target}`,
  ];
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
  return parts.join("\n");
}
