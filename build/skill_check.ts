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
 * A YAML block-scalar indicator (`>`, `|`, with optional chomping/indent
 * modifiers). This validator does not resolve block scalars, so a field using
 * one must be reported as uncheckable rather than validated as the one-char
 * indicator it parses to.
 */
const BLOCK_SCALAR = /^[>|][+-]?[0-9]*$/;

/**
 * A `SKILL.md`'s parsed frontmatter block: the single-line fields it declares
 * and any keys it repeats.
 */
export interface Frontmatter {
  /** The last value seen for each `key: value` line. */
  fields: Record<string, string>;
  /**
   * Keys that appeared more than once. Strict YAML parsers reject a document
   * with duplicated keys outright, so these fail validation.
   */
  duplicates: string[];
}

/**
 * Parse a `SKILL.md`'s leading YAML frontmatter block, or `undefined` when
 * the document has no closed frontmatter fence.
 *
 * This is deliberately not a YAML parser, but it errs strict where YAML is
 * strict: a `key:value` line without a space is not a YAML mapping and is not
 * recorded (so a required field written that way is reported missing), a
 * quoted scalar is unquoted the way a real loader would resolve it, and a
 * leading UTF-8 byte-order mark is stripped the way real loaders strip it.
 */
export function parseFrontmatter(text: string): Frontmatter | undefined {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trimEnd() !== "---") return undefined;
  const fields: Record<string, string> = {};
  const duplicates: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.trimEnd() === "---") return { fields, duplicates };
    // YAML requires whitespace between the colon and a value; a bare `key:`
    // line is an (empty) value of its own.
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/.exec(line);
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (key in fields) duplicates.push(key);
    fields[key] = unquote((rawValue ?? "").trim());
  }
  return undefined; // Never closed — not a frontmatter block.
}

/** Strip one layer of matching single or double quotes from a scalar. */
function unquote(value: string): string {
  const first = value[0];
  if (value.length >= 2 && (first === '"' || first === "'")) {
    if (value.endsWith(first)) return value.slice(1, -1);
  }
  return value;
}

/**
 * The ways one skill document violates the Agent Skills spec, given the
 * directory name it lives under. Empty means the document conforms.
 */
export function checkSkillDoc(dirName: string, text: string): string[] {
  const frontmatter = parseFrontmatter(text);
  if (frontmatter === undefined) {
    return ["has no YAML frontmatter block (--- ... ---)"];
  }
  const { fields, duplicates } = frontmatter;
  const problems: string[] = duplicates.map((key) =>
    `frontmatter repeats the \`${key}\` key — strict YAML parsers reject ` +
    "duplicated keys"
  );
  const name = fields.name;
  if (name === undefined || name === "") {
    problems.push("frontmatter is missing the required `name` field");
  } else if (BLOCK_SCALAR.test(name)) {
    problems.push(
      "`name` uses a YAML block scalar, which this validator cannot check — " +
        "keep it on one line",
    );
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
  } else if (BLOCK_SCALAR.test(description)) {
    problems.push(
      "`description` uses a YAML block scalar, which this validator cannot " +
        "check — keep it on one line",
    );
  } else if (description.length > DESCRIPTION_MAX) {
    problems.push(
      `description is ${description.length} chars (max ${DESCRIPTION_MAX})`,
    );
  }
  return problems;
}

/**
 * Validate every skill folder under `root` — symlinked folders included,
 * since a harness resolving the link would serve whatever it points at.
 * Returns one message per problem, each prefixed with the offending
 * `SKILL.md`'s path; empty means the whole tree conforms to the spec.
 */
export async function checkSkillTree(
  root: string = SKILLS_ROOT,
): Promise<string[]> {
  const problems: string[] = [];
  const dirs: string[] = [];
  try {
    for await (const entry of Deno.readDir(root)) {
      if (entry.isDirectory) {
        dirs.push(entry.name);
      } else if (entry.isSymlink) {
        // A dangling link resolves to nothing a harness could serve; skip it.
        const info = await Deno.stat(`${root}/${entry.name}`).catch(() => null);
        if (info?.isDirectory === true) dirs.push(entry.name);
      }
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
    const info = await Deno.stat(doc).catch((error: unknown) => {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    });
    if (info === null) {
      problems.push(`${doc}: missing — every skill folder needs a SKILL.md`);
      continue;
    }
    if (!info.isFile) {
      problems.push(`${doc}: is not a regular file`);
      continue;
    }
    for (const problem of checkSkillDoc(dir, await Deno.readTextFile(doc))) {
      problems.push(`${doc}: ${problem}`);
    }
  }
  return problems;
}
