// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `build/action_notes.ts` — the release notes the Marketplace
 * action's releases carry.
 *
 * Two of the fixtures are the real thing: the `action.yml` diffs that v1.0.4
 * and v1.0.5 actually shipped, which are also the two releases that went
 * unpublished for six days. They are here because they are the two shapes this
 * has to get right — a Dependabot pin bump, and a change to nothing the
 * generator can name — and because notes generated for a release that already
 * happened can be read against the ones a human wrote for it.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import {
  actionReleaseNotes,
  actionReleaseTitle,
} from "../build/action_notes.ts";
import { usesPins } from "../build/action_uses.ts";

const SLUG = "zuke-build/zuke";
const SHA = "2478fa5a69fb4f16540e54959c98cd976ec3f075";

/** An `action.yml` with `inputs` and one pinned step. */
function manifest(
  options: { harden?: string; hardenSha?: string; inputs?: string[] } = {},
): string {
  const inputs = options.inputs ?? ["target", "ref"];
  const sha = options.hardenSha ?? "0".repeat(40);
  return `name: "Zuke Build"
inputs:
${inputs.map((name) => `  ${name}:\n    description: "x"`).join("\n")}

runs:
  using: composite
  steps:
    - name: Harden the runner
      uses: step-security/harden-runner@${sha} # ${options.harden ?? "v2.21.0"}
    - name: Checkout
      uses: actions/checkout@${"3".repeat(40)} # v7.0.1
`;
}

Deno.test("the title is the one the released versions already carry", () => {
  assertEquals(actionReleaseTitle("v1.0.6"), "Zuke Build v1.0.6");
});

Deno.test("a pin bump is named, with the version beside it", () => {
  // What v1.0.4 actually was: harden-runner v2.21.0 to v2.21.1, nothing else.
  const notes = actionReleaseNotes({
    slug: SLUG,
    version: "v1.0.4",
    sha: SHA,
    source: manifest({ harden: "v2.21.1", hardenSha: "1".repeat(40) }),
    inputs: ["target", "ref"],
    previous: {
      tag: "v1.0.3",
      source: manifest({ harden: "v2.21.0" }),
      inputs: ["target", "ref"],
    },
  });

  assertStringIncludes(
    notes,
    "Updates `step-security/harden-runner` to v2.21.1.",
  );
  // The action whose pin did not move is not mentioned.
  assertEquals(notes.includes("actions/checkout"), false);
  assertStringIncludes(notes, "the same 2 inputs");
  assertStringIncludes(notes, `${SLUG}@${SHA}`);
  assertStringIncludes(
    notes,
    `https://github.com/${SLUG}/compare/v1.0.3...v1.0.4`,
  );
});

Deno.test("a change the generator cannot name says so instead of inventing one", () => {
  // What v1.0.5 actually was: the `ref` input's *description* was rewritten.
  // No pin moved and no input changed, so there is nothing in the file to
  // name — and a confident summary here would be a fabricated one.
  const source = manifest();
  const notes = actionReleaseNotes({
    slug: SLUG,
    version: "v1.0.5",
    sha: SHA,
    source: `${source}# a comment that changes no input and no pin\n`,
    inputs: ["target", "ref"],
    previous: { tag: "v1.0.4", source, inputs: ["target", "ref"] },
  });

  assertStringIncludes(notes, "without changing an input or a pinned action");
  assertStringIncludes(notes, "The compare view below is the diff.");
  assertStringIncludes(notes, "the same 2 inputs");
});

Deno.test("an added input is named, because it is what a caller can now pass", () => {
  const notes = actionReleaseNotes({
    slug: SLUG,
    version: "v1.1.0",
    sha: SHA,
    source: manifest({ inputs: ["target", "ref", "deno-version"] }),
    inputs: ["target", "ref", "deno-version"],
    previous: {
      tag: "v1.0.5",
      source: manifest(),
      inputs: ["target", "ref"],
    },
  });
  assertStringIncludes(notes, "adds `deno-version`");
  assertStringIncludes(notes, "3 inputs in total");
  assertEquals(notes.includes("Nothing about the action's interface"), false);
});

Deno.test("a removed input carries the warning that GitHub will not fail", () => {
  // The one change describable here that breaks a caller who did nothing, and
  // it breaks them quietly: an undeclared input is a warning, not an error, so
  // the step simply runs without it.
  const notes = actionReleaseNotes({
    slug: SLUG,
    version: "v2.0.0",
    sha: SHA,
    source: manifest({ inputs: ["target"] }),
    inputs: ["target"],
    previous: {
      tag: "v1.0.5",
      source: manifest(),
      inputs: ["target", "ref"],
    },
  });
  assertStringIncludes(notes, "removes `ref`");
  assertStringIncludes(notes, "GitHub warns and carries on");
});

Deno.test("the first release has nothing to diff and says only what it is", () => {
  const notes = actionReleaseNotes({
    slug: SLUG,
    version: "v1.0.0",
    sha: SHA,
    source: manifest(),
    inputs: ["target", "ref"],
  });
  assertStringIncludes(notes, "The first release");
  assertStringIncludes(notes, "2 inputs");
  assertStringIncludes(notes, `${SLUG}@${SHA}`);
  // Nothing to compare against, so no link that would 404.
  assertEquals(notes.includes("/compare/"), false);
});

Deno.test("a bumped pin with no version comment names the commit, not a guess", () => {
  // Dependabot maintains the `# vX.Y.Z` beside the SHA, but a hand-added pin
  // may carry none — and stating a version that is not written down would be
  // worse than naming the commit that is.
  const bumped = manifest({ hardenSha: "1".repeat(40) })
    .replace(" # v2.21.0", "");
  const notes = actionReleaseNotes({
    slug: SLUG,
    version: "v1.0.6",
    sha: SHA,
    source: bumped,
    inputs: ["target", "ref"],
    previous: {
      tag: "v1.0.5",
      source: manifest(),
      inputs: ["target", "ref"],
    },
  });
  assertStringIncludes(
    notes,
    `Updates \`step-security/harden-runner\` to \`${"1".repeat(40)}\`.`,
  );
});

Deno.test("the same revisions always render the same body", () => {
  // The notes are written once, but the reconciliation reads them on every
  // run — so a body that varied would make an unchanged release look edited.
  const change = {
    slug: SLUG,
    version: "v1.0.6",
    sha: SHA,
    source: manifest({ harden: "v2.21.1", hardenSha: "1".repeat(40) }),
    inputs: ["target", "ref"],
    previous: {
      tag: "v1.0.5",
      source: manifest(),
      inputs: ["target", "ref"],
    },
  };
  assertEquals(actionReleaseNotes(change), actionReleaseNotes(change));
});

Deno.test("only SHA pins are read, so a floating uses: is not mistaken for one", () => {
  // A floating `uses: actions/checkout@v4` is not a pin, and counting one
  // would let a reference this repository never generates pass for a value it
  // did.
  const pins = usesPins(
    `    - uses: actions/checkout@v4\n` +
      `    - uses: actions/setup-node@${"a".repeat(40)} # v5.0.0\n` +
      `      # uses: not/a-step@${"b".repeat(40)}\n`,
  );
  assertEquals([...pins.keys()], ["actions/setup-node"]);
  assertEquals(pins.get("actions/setup-node")?.version, "v5.0.0");
});

Deno.test("the real action.yml's pins are readable by the notes generator", () => {
  // Against the committed file rather than a fixture: the generator reads
  // whatever `action.yml` actually looks like, and a change to its formatting
  // that stopped the pins parsing would otherwise surface as notes that
  // silently stop naming bumps.
  const pins = usesPins(Deno.readTextFileSync("action.yml"));
  assertEquals(pins.has("step-security/harden-runner"), true);
  assertEquals(pins.has("actions/checkout"), true);
  for (const [action, pin] of pins) {
    assertStringIncludes(pin.ref, `${action}@`);
    assertEquals(pin.version?.startsWith("v"), true);
  }
});

Deno.test("a comment that is not a version is not quoted as one", () => {
  // The text after `#` on a `uses:` line is free-form, and it is rendered into
  // the body. Dependabot writes a version there and nothing else does, so
  // anything that is not one means the pin was hand-edited — and the SHA is
  // then the honest thing to print. It also keeps a stray backtick out of a
  // body that quotes the value inside backticks.
  const bumped = manifest({ hardenSha: "1".repeat(40) })
    .replace("# v2.21.0", "# pin to `latest`");
  const notes = actionReleaseNotes({
    slug: SLUG,
    version: "v1.0.6",
    sha: SHA,
    source: bumped,
    inputs: ["target", "ref"],
    previous: { tag: "v1.0.5", source: manifest(), inputs: ["target", "ref"] },
  });
  assertEquals(notes.includes("pin to"), false);
  assertStringIncludes(notes, `to \`${"1".repeat(40)}\`.`);
});
