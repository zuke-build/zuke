// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  buildAdjudicatePrompt,
  buildDedupPrompt,
  buildPrompt,
  buildVerifyPrompt,
} from "../src/prompt.ts";
import { rebuttalComment } from "../src/prompts/templates.ts";
import { fixSystemPrompt, fixUserPrompt } from "../src/prompts/fix.ts";
import { agentPrompt } from "../src/prompts/agent.ts";

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
    // The fixers, which act on what they are told rather than only scoring it,
    // and so are the prompts where a missing fence costs the most.
    {
      system: fixSystemPrompt(),
      user: fixUserPrompt({
        target: "test",
        output: "boom",
        diff: "a diff",
        conventions: "no `any`",
      }),
    },
    // The agent gets one message, so it announces and emits in the same string.
    ((p: string) => ({ system: p, user: p }))(agentPrompt({
      target: "test",
      output: "boom",
      conventions: "no `any`",
    })),
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
    "UNTRUSTED",
    "PROJECT_CONVENTIONS",
    "UNTRUSTED",
    "PROJECT_CONVENTIONS",
  ]);
});
