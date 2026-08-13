// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the metadata half of the root `action.yml` — the fields that
 * exist because the composite action is published to the GitHub Marketplace,
 * rather than because the build reads them.
 *
 * These are asserted here because nothing else fails when they go missing. The
 * pins have `action_pins_test.ts` and a generation gate behind them; `name`,
 * `description` and `branding` are read only by GitHub's publish form, so a
 * dropped `branding:` block stays invisible until someone tries to cut a
 * release and the form rejects it. That is the wrong moment to find out.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";

/** The manifest, read once — every test here asserts against the real file. */
const MANIFEST = Deno.readTextFileSync("action.yml");

/**
 * The badge colours GitHub accepts. Anything else is a validation error on the
 * publish form, so the set is worth spelling out rather than matching `\S+`.
 */
const BRANDING_COLORS = [
  "white",
  "black",
  "yellow",
  "blue",
  "green",
  "orange",
  "red",
  "purple",
  "gray-dark",
];

/**
 * Feather v4.28.0 icons that GitHub does *not* accept: its brand marks, plus a
 * short list it omits for its own reasons. Naming a real Feather icon from this
 * set is the plausible mistake — it looks right, resolves in every icon
 * reference, and is rejected only by the publish form.
 *
 * This is the half of the check that can be made offline. Shipping all ~280
 * legal names to assert membership positively would be a copy of Feather's
 * manifest that goes stale on their next release; excluding the set GitHub
 * documents catches the wrong-but-plausible value without that upkeep.
 */
const OMITTED_ICONS = [
  "coffee",
  "columns",
  "divide",
  "divide-circle",
  "divide-square",
  "frown",
  "hexagon",
  "key",
  "meh",
  "mouse-pointer",
  "smile",
  "tool",
  "x-octagon",
  "chrome",
  "codepen",
  "codesandbox",
  "dribbble",
  "figma",
  "framer",
  "github",
  "gitlab",
  "instagram",
  "linkedin",
  "pen-tool",
  "slack",
  "table",
  "trello",
  "twitch",
  "twitter",
  "youtube",
];

/** A scalar under `branding:`, with or without quotes, in either key order. */
function brandingValue(key: string): string | undefined {
  const block = /^branding:\n((?: {2}\w+:.*\n)+)/m.exec(MANIFEST)?.[1];
  const value = new RegExp(`^ {2}${key}: "?([^"\\n]+?)"?$`, "m")
    .exec(block ?? "")?.[1];
  return value;
}

Deno.test("the manifest names the action as the Marketplace listing does", () => {
  // The listing's unique identifier. Changing it is not a rename but a new
  // listing, so it is worth pinning to the value that was actually published.
  // "Zuke" alone is rejected: the uniqueness check spans users and
  // organizations as well as listings, and github.com/zuke is a real account.
  // "Zuke Build" slugs to this repository's own org, which the rule exempts
  // because that owner is the one publishing.
  assertEquals(
    /^name: "Zuke Build"$/m.test(MANIFEST),
    true,
    'action.yml does not declare `name: "Zuke Build"`',
  );
});

Deno.test("the manifest carries a non-empty description", () => {
  // Shown under the name in Marketplace search results, and required.
  assertEquals(
    /^description: "[^"]+"$/m.test(MANIFEST),
    true,
    "action.yml has no single-line, non-empty description",
  );
});

Deno.test("the manifest carries a branding badge", () => {
  // Documented as optional; the publish form rejects a release without it.
  const icon = brandingValue("icon");
  const color = brandingValue("color");
  assertEquals(
    icon !== undefined && color !== undefined,
    true,
    "action.yml has no `branding:` block with an `icon:` and a `color:`",
  );
  assertEquals(
    /^[a-z][a-z-]*$/.test(icon ?? ""),
    true,
    `branding.icon is not shaped like a Feather icon name: ${icon}`,
  );
  assertEquals(
    OMITTED_ICONS.includes(icon ?? ""),
    false,
    `branding.icon is a Feather icon GitHub omits, and the publish form will ` +
      `reject it: ${icon}`,
  );
  assertEquals(
    BRANDING_COLORS.includes(color ?? ""),
    true,
    `branding.color must be one of ${BRANDING_COLORS.join(", ")}: ${color}`,
  );
});

Deno.test("no shell script in the action interpolates a template expression", () => {
  // The regression test for the injection this action was already fixed once
  // for. `inputs.target` reaches the shell through `env:` and is quoted, rather
  // than being expanded into the script text, where a caller deriving it from a
  // pull-request title would be handing this action arbitrary code. Only a
  // comment protected that; a contributor "simplifying" the step back to
  // `run: ./zuke ${{ inputs.target }}` would pass lint, types and coverage.
  //
  // The property is easy to state and worth stating broadly: no `run:` script
  // in this file interpolates anything. Values arrive as environment variables.
  const scripts = [...MANIFEST.matchAll(/^ {6}run: \|\n((?: {8}.*\n)+)/gm)]
    .map(([, body]) => body);
  assertEquals(
    scripts.length > 0,
    true,
    "found no `run:` block in action.yml — has the step been restructured?",
  );
  for (const script of scripts) {
    assertEquals(
      script.includes("${{"),
      false,
      `a run: script interpolates a template expression:\n${script}`,
    );
  }
  // The other half of the fix: the value is passed as one quoted argument, so a
  // target containing spaces or shell metacharacters stays a single argv entry.
  assertStringIncludes(MANIFEST, "ZUKE_TARGET: ${{ inputs.target }}");
  assertStringIncludes(MANIFEST, './zuke "$ZUKE_TARGET"');
});

Deno.test("a custom ref is refused on every secret-bearing event", () => {
  // The `ref` input exists because this repository's own gate job needs it to
  // push a fix to a pull request's head branch. It also hands every consumer
  // the classic escalation: on `pull_request_target` the job holds the base
  // repository's secrets and a writable token, and a `ref` aimed at a pull
  // request's head puts a contributor's `zuke.ts` where the last step runs it.
  //
  // The refusal is the mitigation, and it is only as good as its condition —
  // so assert the condition, not just that some guard exists. All three
  // clauses must be present, or it stops covering the case it was added for.
  assertStringIncludes(MANIFEST, "inputs.ref != ''");
  assertStringIncludes(MANIFEST, "::error::Refusing to check out a custom ref");

  // An allowlist, negated — not a denylist. A denylist of what is dangerous
  // today is wrong the moment GitHub adds an event, and wrong silently, since
  // the guard just does not fire. This assertion is the one that would fail if
  // someone "simplified" it back: the `!` and the safe-event names must both
  // be present.
  assertStringIncludes(MANIFEST, "!contains(fromJSON(");
  for (
    const event of [
      "pull_request",
      "push",
      "merge_group",
      "workflow_dispatch",
      "schedule",
      "release",
    ]
  ) {
    assertStringIncludes(MANIFEST, `"${event}"`);
  }
  // The dangerous ones must NOT appear: naming them would mean the list had
  // been flipped back to a denylist.
  for (
    const event of [
      "pull_request_target",
      "issue_comment",
      "workflow_run",
      "discussion_comment",
    ]
  ) {
    assertEquals(
      MANIFEST.includes(`"${event}"`),
      false,
      `${event} is named in the guard, so it has become a denylist again`,
    );
  }

  // NOT keyed on `target`. A caller who omits it and writes `run: ./zuke ci`
  // in their own next step gets the identical outcome, so a refusal that
  // required a target would guard one spelling of the mistake, not the
  // mistake. This assertion is what stops that clause being reintroduced as a
  // "narrowing".
  const guard = /- name: Refuse an untrusted checkout[\s\S]*?exit 1/.exec(
    MANIFEST,
  )?.[0] ?? "";
  assertEquals(
    guard.includes("inputs.target"),
    false,
    "the refusal is keyed on `target`, so omitting it bypasses the guard",
  );
  // Refused, not warned: a step that printed and continued would still leave
  // the untrusted code in the workspace for whatever runs next.
  assertStringIncludes(guard, "exit 1");
  // `pull_request` must be allowed, or the guard would refuse this
  // repository's own gate job — the reason the `ref` input exists at all.
  assertStringIncludes(guard, '"pull_request"');
});

Deno.test("the checkout honours the ref input", () => {
  // Without this the input would be accepted, documented, guarded — and
  // silently ignored, checking out the event's default ref instead.
  assertStringIncludes(MANIFEST, "ref: ${{ inputs.ref }}");
});

Deno.test("running a target checks for the launcher it needs", () => {
  // The action checks the caller's repository out and then runs `./zuke` in it,
  // so a caller who found this on Marketplace but has never scaffolded Zuke
  // gets a bare "No such file or directory" from the shell. The guard turns
  // that into an annotation naming the fix; without it the action's worst first
  // impression is also its most likely one.
  assertStringIncludes(MANIFEST, "if [ ! -f ./zuke ]; then");
  assertStringIncludes(MANIFEST, "::error::No ./zuke launcher");
  // The annotation without the exit would print the diagnosis and then run the
  // launcher anyway, which is the failure it exists to replace.
  assertStringIncludes(MANIFEST, "exit 1");
});
