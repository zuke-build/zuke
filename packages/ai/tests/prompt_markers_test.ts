import { assertEquals } from "../../core/tests/_assert.ts";
import {
  buildAdjudicatePrompt,
  buildDedupPrompt,
  buildPrompt,
  buildVerifyPrompt,
} from "../src/prompt.ts";
import { rebuttalComment } from "../src/prompts/templates.ts";

/**
 * Every fence marker a system prompt announces (the `"<<<NAME"` strings the
 * injection guards refer to) must match a fence the user prompt actually
 * emits — a drifted name would leave a guard pointing at nothing, quietly
 * weakening the anti-injection framing. Regression test for review finding
 * `q4wvfi90ig3c`, which claimed such a mismatch: this proves marker
 * consistency across every prompt-building path, with all extras active.
 */
Deno.test("announced injection-guard markers match the emitted fences", () => {
  const extras = {
    conventions: "no `any`",
    files: "file contents",
    dismissed: ["id1 — a dismissed finding"],
    prior: ["id2 — a still-open finding"],
  };
  const prompts = [
    buildPrompt("security", "criteria", "the diff", extras),
    buildVerifyPrompt(
      "security",
      [{ id: "x", title: "candidate" }],
      "the diff",
      extras,
    ),
    buildAdjudicatePrompt("security", [{
      id: "x",
      title: "contested",
      comments: [rebuttalComment("maintainer", "MEMBER", "rebuttal body")],
    }], "the diff"),
    buildDedupPrompt("security", [{
      label: "p1",
      file: "src/app.ts",
      title: "new wording",
      detail: "the detail",
      priorTitle: "old wording",
    }]),
  ];
  const announced: string[] = [];
  for (const { system, user } of prompts) {
    for (const match of system.matchAll(/"<<<([A-Z_]+)"/g)) {
      const name = match[1];
      announced.push(name);
      assertEquals(
        user.includes(`<<<${name}`),
        true,
        `system prompt announces <<<${name} but the user prompt never opens it`,
      );
      assertEquals(
        user.includes(`${name}>>>`),
        true,
        `system prompt announces ${name}>>> but the user prompt never closes it`,
      );
    }
  }
  // Guard the guard: the extraction saw every block the prompts can carry —
  // if a marker is renamed or a new fenced block forgets its announcement,
  // this inventory changes and the test points straight at it.
  assertEquals(announced, [
    "UNTRUSTED_DIFF",
    "UNTRUSTED_FILES",
    "PROJECT_CONVENTIONS",
    "DISMISSED_FINDINGS",
    "PRIOR_FINDINGS",
    "UNTRUSTED_DIFF",
    "UNTRUSTED_FILES",
    "UNTRUSTED_COMMENT",
    "UNTRUSTED_PAIR",
  ]);
});
