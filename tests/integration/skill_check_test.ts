// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the `skillsCheck`-style target wiring — validate a skills tree
 * against the Agent Skills spec and fail the build on a violation — driven
 * through the real CLI, mirroring how `zuke.ts`'s own `skillsCheck` target is
 * wired (see `zuke.ts` and `build/skill_check.ts`).
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { checkSkillTree } from "../../build/skill_check.ts";
import { runCli } from "./_harness.ts";

/** A fixture build gating on spec violations under `root`, like `skillsCheck`. */
function gateBuild(root: string) {
  class Gate extends Build {
    check = target().executes(async () => {
      const problems = await checkSkillTree(root);
      if (problems.length > 0) {
        throw new Error(`violates the spec:\n  ${problems.join("\n  ")}`);
      }
      console.log("skills conform");
    });
  }
  return Gate;
}

Deno.test("skillsCheck passes a conforming tree through the CLI", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/my-skill`);
    await Deno.writeTextFile(
      `${dir}/my-skill/SKILL.md`,
      "---\nname: my-skill\ndescription: Toggles the widget.\n---\n\n# My skill\n",
    );

    const { code, out } = await runCli(gateBuild(dir), ["check"]);
    assertEquals(code, 0);
    assertStringIncludes(out, "skills conform");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("skillsCheck fails loudly on a renamed directory through the CLI", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // The realistic slip: the folder was renamed, the frontmatter was not.
    await Deno.mkdir(`${dir}/new-name`);
    await Deno.writeTextFile(
      `${dir}/new-name/SKILL.md`,
      "---\nname: old-name\ndescription: Toggles the widget.\n---\n",
    );

    const { code, err } = await runCli(gateBuild(dir), ["check"]);
    assertEquals(code, 1);
    assertStringIncludes(err, "violates the spec");
    assertStringIncludes(err, '"old-name"');
    assertStringIncludes(err, '"new-name"');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
