// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Validates the `skills/` tree against the Agent Skills standard
 * (<https://agentskills.io/specification>).
 *
 * The skills are no longer consumed by Claude Code alone: the repo serves the
 * same folders to Codex (via the plugin manifests) and to Gemini CLI (via the
 * root `gemini-extension.json`, which auto-discovers `skills/`). Both of those
 * harnesses — and the standard itself — require the frontmatter `name` to
 * match the skill's directory name, so a rename that touches only one side
 * ships a skill that silently fails to load. `skillsCheck` in `zuke.ts` runs
 * this over `skills/` so the gate catches it instead.
 *
 * @module
 */

/** The skills tree that every distribution surface serves. */
export const SKILLS_ROOT = "skills";

/** `name` per the spec: lowercase alphanumerics and single hyphens, 1–64 chars. */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The spec's maximum `name` length. */
const NAME_MAX = 64;

/** The spec's maximum `description` length. */
const DESCRIPTION_MAX = 1024;

/**
 * Parse a `SKILL.md`'s leading YAML frontmatter block into its single-line
 * `key: value` fields, or `undefined` when the document has no frontmatter.
 *
 * This is deliberately not a YAML parser: the spec's required fields (`name`,
 * `description`) are scalar strings, and the skills in this repo keep them on
 * one line. A multi-line value is simply not seen, which for a validator errs
 * on the side of reporting a field missing rather than passing garbage.
 */
export function parseFrontmatter(
  text: string,
): Record<string, string> | undefined {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return undefined;
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    if (line === "---") return fields;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]?(.*)$/.exec(line);
    if (match !== null) fields[match[1]] = match[2].trim();
  }
  return undefined; // Never closed — not a frontmatter block.
}

/**
 * The ways one skill document violates the Agent Skills spec, given the
 * directory name it lives under. Empty means the document conforms.
 */
export function checkSkillDoc(dirName: string, text: string): string[] {
  const fields = parseFrontmatter(text);
  if (fields === undefined) {
    return ["has no YAML frontmatter block (--- ... ---)"];
  }
  const problems: string[] = [];
  const name = fields.name;
  if (name === undefined || name === "") {
    problems.push("frontmatter is missing the required `name` field");
  } else {
    if (name !== dirName) {
      problems.push(
        `frontmatter name "${name}" does not match the directory "${dirName}" — ` +
          "Gemini CLI and the Agent Skills spec require them to be identical",
      );
    }
    if (!NAME_PATTERN.test(name)) {
      problems.push(
        `name "${name}" is not lowercase alphanumerics with single hyphens`,
      );
    }
    if (name.length > NAME_MAX) {
      problems.push(`name is ${name.length} chars (max ${NAME_MAX})`);
    }
  }
  const description = fields.description;
  if (description === undefined || description === "") {
    problems.push("frontmatter is missing the required `description` field");
  } else if (description.length > DESCRIPTION_MAX) {
    problems.push(
      `description is ${description.length} chars (max ${DESCRIPTION_MAX})`,
    );
  }
  return problems;
}

/**
 * Validate every skill folder under `root`. Returns one message per problem,
 * each prefixed with the offending `SKILL.md`'s path; empty means the whole
 * tree conforms to the spec.
 */
export async function checkSkillTree(
  root: string = SKILLS_ROOT,
): Promise<string[]> {
  const problems: string[] = [];
  const dirs: string[] = [];
  try {
    for await (const entry of Deno.readDir(root)) {
      if (entry.isDirectory) dirs.push(entry.name);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [`${root}: missing — the skills tree is gone entirely`];
    }
    throw error;
  }
  dirs.sort();
  for (const dir of dirs) {
    const doc = `${root}/${dir}/SKILL.md`;
    let text: string;
    try {
      text = await Deno.readTextFile(doc);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        problems.push(`${doc}: missing — every skill folder needs a SKILL.md`);
        continue;
      }
      throw error;
    }
    for (const problem of checkSkillDoc(dir, text)) {
      problems.push(`${doc}: ${problem}`);
    }
  }
  return problems;
}
