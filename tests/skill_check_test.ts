// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the Agent Skills spec validator behind the `skillsCheck`
 * gate target. Codex and Gemini CLI load the `skills/` folders directly, and
 * both require the frontmatter `name` to match the directory — a mismatch
 * ships a skill that silently fails to load, which is exactly the kind of
 * quiet breakage the gate exists to catch.
 *
 * The parser cases mirror strict YAML where it matters: a document that a
 * real loader would reject (no space after the colon, duplicated keys) must
 * not pass here just because a naive line parser could make sense of it.
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
    fields: { name: "a-skill", description: "Does a thing." },
    duplicates: [],
  });
  // No opening fence, no fence at all, and an unclosed fence are all "none".
  assertEquals(parseFrontmatter("# Just markdown\n"), undefined);
  assertEquals(parseFrontmatter(""), undefined);
  assertEquals(parseFrontmatter("---\nname: x\n"), undefined);
  // CRLF documents parse the same as LF ones (a Windows checkout).
  assertEquals(parseFrontmatter("---\r\nname: x\r\n---\r\n")?.fields, {
    name: "x",
  });
  // Lines that are not `key: value` are skipped, not fatal.
  assertEquals(parseFrontmatter("---\nname: x\nnot a field\n---\n")?.fields, {
    name: "x",
  });
});

Deno.test("the parser mirrors what a real YAML loader would resolve", () => {
  // Loaders strip a leading BOM before looking for the fence.
  assertEquals(parseFrontmatter("﻿---\nname: x\n---\n")?.fields, {
    name: "x",
  });
  // A fence with trailing whitespace still closes the block.
  assertEquals(parseFrontmatter("---\nname: x\n--- \n")?.fields, { name: "x" });
  // A quoted scalar resolves to its content, not to the quoted text.
  assertEquals(parseFrontmatter('---\nname: "x"\n---\n')?.fields, {
    name: "x",
  });
  assertEquals(parseFrontmatter("---\nname: 'x'\n---\n")?.fields, {
    name: "x",
  });
  // `key:value` without a space is NOT a YAML mapping — the field must not be
  // recorded, or a document every harness rejects would pass the gate.
  assertEquals(parseFrontmatter("---\nname:x\n---\n")?.fields, {});
  // A bare `key:` line is an empty value, which the doc checks treat as missing.
  assertEquals(parseFrontmatter("---\nname:\n---\n")?.fields, { name: "" });
  // Duplicated keys are recorded — strict YAML parsers reject the document.
  assertEquals(
    parseFrontmatter("---\nname: a\nname: b\n---\n")?.duplicates,
    ["name"],
  );
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
  // `name:x` with no space is not a mapping in YAML, so `name` is missing.
  assertStringIncludes(
    checkSkillDoc("x", "---\nname:x\ndescription: d\n---\n").join("\n"),
    "`name`",
  );
});

Deno.test("YAML the validator cannot resolve is a finding, not a pass", () => {
  // A block-scalar description resolves to kilobytes in a real loader; the
  // naive value is the one-char indicator, which must not sail through the
  // presence and length checks.
  const folded = "---\nname: x\ndescription: >\n  long text\n---\n";
  assertStringIncludes(
    checkSkillDoc("x", folded).join("\n"),
    "block scalar",
  );
  assertStringIncludes(
    checkSkillDoc("x", "---\nname: |\ndescription: d\n---\n").join("\n"),
    "block scalar",
  );
  // Duplicated keys fail loudly, matching the strict parsers that reject them.
  assertStringIncludes(
    checkSkillDoc("x", "---\nname: x\nname: x\ndescription: d\n---\n")
      .join("\n"),
    "repeats",
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
    // A SKILL.md that is not a regular file is a finding, not a crash.
    await Deno.mkdir(`${dir}/odd/SKILL.md`, { recursive: true });

    const problems = await checkSkillTree(dir);
    assertEquals(problems.length, 3);
    assertStringIncludes(problems[0], `${dir}/empty/SKILL.md: missing`);
    assertStringIncludes(problems[1], `${dir}/odd/SKILL.md`);
    assertStringIncludes(problems[1], "not a regular file");
    assertStringIncludes(problems[2], `${dir}/renamed/SKILL.md`);
    assertStringIncludes(problems[2], '"old-name"');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "a symlinked skill folder is validated, not skipped",
  // Creating symlinks on Windows needs a privilege the CI runner may lack.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${dir}/real`);
      await Deno.writeTextFile(`${dir}/real/SKILL.md`, doc("wrong-name"));
      await Deno.mkdir(`${dir}/tree`);
      await Deno.symlink(`${dir}/real`, `${dir}/tree/linked`);
      // A dangling link resolves to nothing a harness could serve.
      await Deno.symlink(`${dir}/gone`, `${dir}/tree/dangling`);

      const problems = await checkSkillTree(`${dir}/tree`);
      assertEquals(problems.length, 1);
      assertStringIncludes(problems[0], `${dir}/tree/linked/SKILL.md`);
      assertStringIncludes(problems[0], '"wrong-name"');
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
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
