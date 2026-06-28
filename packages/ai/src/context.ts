/**
 * Shared failure-context helpers used by both the structured {@link
 * "./fixer.ts".AiFixer} and the delegating {@link "./agent_fixer.ts".AgentFixer}:
 * extracting the failed command and output from an error, and resolving the
 * project conventions to feed the model.
 *
 * @module
 */

import { CommandError } from "@zuke/core/shell";

/** The files a fixer reads, in order, for project conventions. */
const CONVENTION_FILES = ["CLAUDE.md", "AGENTS.md"];

/** Read a text file, returning `undefined` when it cannot be read. */
export async function readTextOrUndefined(
  path: string,
): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}

/**
 * Extract the failed command and its output from a target's error. A shell
 * {@link CommandError} carries the command line and captured `stderr`; anything
 * else falls back to the error message.
 */
export function describeError(
  error: unknown,
): { command?: string; output: string } {
  if (error instanceof CommandError) {
    const output = error.stderr.trim();
    return {
      command: error.command,
      output: output === "" ? error.message : output,
    };
  }
  if (error instanceof Error) return { output: error.message };
  return { output: String(error) };
}

/**
 * Resolve the project conventions sent to the model: the explicitly-supplied
 * text (an empty string means "send none"), or the first of `CLAUDE.md` /
 * `AGENTS.md` that can be read. The `read` seam is overridable for tests.
 */
export async function resolveConventions(
  explicit: string | undefined,
  read: (path: string) => Promise<string | undefined> = readTextOrUndefined,
): Promise<string | undefined> {
  if (explicit !== undefined) return explicit === "" ? undefined : explicit;
  for (const file of CONVENTION_FILES) {
    const text = await read(file);
    if (text !== undefined && text !== "") return text;
  }
  return undefined;
}
