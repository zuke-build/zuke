// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the Agent Skills spec validator behind the `skillsCheck`
 * gate target. Codex and Gemini CLI load the `skills/` folders directly, and
 * both require the frontmatter `name` to match the directory — a mismatch
 * ships a skill that silently fails to load, which is exactly the kind of
 * quiet breakage the gate exists to catch.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import {
  checkSkillDoc,
  checkSkillTree,
  parseFrontmatter,
} from "../build/skill_check.ts";

/** A conforming SKILL.md body for the given name. */
function doc(name: string, description = "Does a thing."): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# Body\n`;
}

Deno.test("frontmatter parses single-line fields and rejects non-frontmatter", () => {
  assertEquals(parseFrontmatter(doc("a-skill")), {
    name: "a-skill",
    description: "Does a thing.",
  });
  // No opening fence, no fence at all, and an unclosed fence are all "none".
  assertEquals(parseFrontmatter("# Just markdown\n"), undefined);
  assertEquals(parseFrontmatter(""), undefined);
  assertEquals(parseFrontmatter("---\nname: x\n"), undefined);
  // CRLF documents parse the same as LF ones (a Windows checkout).
  assertEquals(parseFrontmatter("---\r\nname: x\r\n---\r\n"), { name: "x" });
  // Lines that are not `key: value` are skipped, not fatal.
  assertEquals(parseFrontmatter("---\nname: x\nnot a field\n---\n"), {
    name: "x",
  });
});

Deno.test("a conforming document has no problems", () => {
  assertEquals(checkSkillDoc("a-skill", doc("a-skill")), []);
});

Deno.test("a name/directory mismatch is the headline failure", () => {
  const problems = checkSkillDoc("a-skill", doc("other-name"));
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], '"other-name"');
  assertStringIncludes(problems[0], '"a-skill"');
});

Deno.test("missing frontmatter, name, and description are each reported", () => {
  assertStringIncludes(checkSkillDoc("x", "# no frontmatter\n")[0], "no YAML");
  assertStringIncludes(
    checkSkillDoc("x", "---\ndescription: d\n---\n").join("\n"),
    "`name`",
  );
  assertStringIncludes(
    checkSkillDoc("x", "---\nname: x\n---\n").join("\n"),
    "`description`",
  );
});

Deno.test("the spec's name shape and length limits are enforced", () => {
  // Uppercase, underscores, and hyphen misuse are all out of shape.
  for (const bad of ["Bad", "has_underscore", "-lead", "trail-", "a--b"]) {
    const problems = checkSkillDoc(bad, doc(bad));
    assertStringIncludes(problems.join("\n"), "lowercase alphanumerics");
  }
  const long = "a".repeat(65);
  assertStringIncludes(checkSkillDoc(long, doc(long)).join("\n"), "max 64");
  const wordy = doc("x", "d".repeat(1025));
  assertStringIncludes(checkSkillDoc("x", wordy).join("\n"), "max 1024");
});

Deno.test("a tree reports missing SKILL.md files and prefixes paths", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/good`);
    await Deno.writeTextFile(`${dir}/good/SKILL.md`, doc("good"));
    await Deno.mkdir(`${dir}/empty`);
    await Deno.mkdir(`${dir}/renamed`);
    await Deno.writeTextFile(`${dir}/renamed/SKILL.md`, doc("old-name"));
    // A stray file at the root is not a skill folder and is ignored.
    await Deno.writeTextFile(`${dir}/README.md`, "not a skill");

    const problems = await checkSkillTree(dir);
    assertEquals(problems.length, 2);
    assertStringIncludes(problems[0], `${dir}/empty/SKILL.md: missing`);
    assertStringIncludes(problems[1], `${dir}/renamed/SKILL.md`);
    assertStringIncludes(problems[1], '"old-name"');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a missing skills root is a finding, not a crash", async () => {
  // The gate should say what is wrong, not die on an unhandled NotFound.
  const problems = await checkSkillTree("no-such-directory");
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], "no-such-directory: missing");
});

Deno.test("the repo's real skills/ tree conforms to the spec", async () => {
  // The actual gate condition: what this repo serves to Claude Code, Codex,
  // and Gemini CLI is valid under the standard they all consume.
  assertEquals(await checkSkillTree(), []);
});
