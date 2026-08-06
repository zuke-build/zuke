/**
 * Unit tests for `build/action_pins.ts` — the module that reads pinned action
 * SHAs back out of the committed workflows so Dependabot stays the thing that
 * bumps them.
 *
 * Each test writes its own throwaway workflow directory, so none of this depends
 * on the repository's real workflows.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../packages/core/tests/_assert.ts";
import { collectActionPins, SEED_PINS } from "../build/action_pins.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/** Write `files` into a fresh temp directory and return its path. */
async function workflows(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir();
  for (const [name, text] of Object.entries(files)) {
    await Deno.writeTextFile(`${dir}/${name}`, text);
  }
  return dir;
}

Deno.test("a pinned uses line yields its action, sha, and version", async () => {
  const dir = await workflows({
    "ci.yml": [
      "jobs:",
      "  build:",
      "    steps:",
      `      - uses: actions/checkout@${SHA_A} # v7.0.1`,
      `      - uses: github/codeql-action/upload-sarif@${SHA_B} # v4.37.4`,
    ].join("\n"),
  });
  try {
    const pins = collectActionPins(dir);
    assertEquals(pins.get("actions/checkout"), {
      ref: `actions/checkout@${SHA_A}`,
      version: "v7.0.1",
    });
    // A subpath action keeps its whole path as the key.
    assertEquals(
      pins.get("github/codeql-action/upload-sarif")?.version,
      "v4.37.4",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a pin with no version comment is still collected", async () => {
  const dir = await workflows({
    "a.yml": `      - uses: actions/checkout@${SHA_A}\n`,
  });
  try {
    assertEquals(collectActionPins(dir).get("actions/checkout"), {
      ref: `actions/checkout@${SHA_A}`,
      version: undefined,
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the file that names the version wins over one that omits it", async () => {
  // Same SHA in both. Without this, the alphabetically-first file would decide,
  // and a generated file with no comment would drop the version Dependabot
  // tracks purely because of directory order.
  const dir = await workflows({
    "a-generated.yml": `      - uses: actions/checkout@${SHA_A}\n`,
    "z-handwritten.yml": `      - uses: actions/checkout@${SHA_A} # v7.0.1\n`,
  });
  try {
    assertEquals(
      collectActionPins(dir).get("actions/checkout")?.version,
      "v7.0.1",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("two files pinning one action to different SHAs is an error", async () => {
  // A half-applied bump. Picking either silently would revert it or spread it
  // only partly, so the error names both files.
  const dir = await workflows({
    "one.yml": `      - uses: actions/checkout@${SHA_A} # v7.0.1\n`,
    "two.yml": `      - uses: actions/checkout@${SHA_B} # v7.0.2\n`,
  });
  try {
    const error = assertThrows(
      () => collectActionPins(dir),
      Error,
      "action pins disagree for actions/checkout",
    );
    assertStringIncludes(error.message, "one.yml");
    assertStringIncludes(error.message, "two.yml");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a floating tag or a short sha is not treated as a pin", async () => {
  // Only a full 40-character SHA counts. A tag is not a pin, and pretending it
  // is would let the generator emit an unpinned reference.
  const dir = await workflows({
    "a.yml": [
      "      - uses: actions/checkout@v4",
      "      - uses: actions/setup-node@abc1234",
      "      # uses: actions/stale@" + SHA_B,
      `      - uses: actions/cache@${SHA_A}`,
    ].join("\n"),
  });
  try {
    const pins = collectActionPins(dir);
    assertEquals(pins.has("actions/checkout"), false);
    assertEquals(pins.has("actions/setup-node"), false);
    assertEquals(pins.has("actions/cache"), true);
    // A commented-out line is not a `uses:` step.
    assertEquals(pins.has("actions/stale"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a missing workflow directory yields no pins rather than throwing", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.remove(dir);
  // Generating into a repository with no workflows yet must fall back to the
  // seed, not fail.
  assertEquals(collectActionPins(dir).size, 0);
});

Deno.test("non-YAML files in the directory are ignored", async () => {
  const dir = await workflows({
    "README.md": `      - uses: actions/checkout@${SHA_B} # v0.0.0`,
    "ci.yaml": `      - uses: actions/checkout@${SHA_A} # v7.0.1`,
  });
  try {
    // The .yaml extension counts; the .md does not — otherwise documentation
    // showing an example pin would fight the real one.
    assertEquals(
      collectActionPins(dir).get("actions/checkout")?.ref.endsWith(SHA_A),
      true,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("every seed pin is a full SHA with a version", () => {
  // The seed only ever bootstraps, but a malformed entry there would emit an
  // unpinned or mislabelled reference into a generated workflow.
  for (const [action, pin] of Object.entries(SEED_PINS)) {
    const [name, sha] = pin.ref.split("@");
    assertEquals(name, action, `${action} ref names a different action`);
    assertEquals(/^[0-9a-f]{40}$/.test(sha), true, `${action} sha: ${sha}`);
    assertEquals(typeof pin.version, "string", `${action} has no version`);
  }
});

Deno.test("no declared workflow hardcodes an action SHA", async () => {
  // The trap this module exists to remove, asserted rather than trusted: a
  // generated workflow whose SHA is a literal in the build (or in a published
  // package) silently reverts a bot's bump on the next run. It had already
  // happened here — `integrationCi` pinned three actions by hand, and
  // @zuke/ai's constant had to be updated to match what Dependabot set.
  const build = await Deno.readTextFile("zuke.ts");
  const literals = build.split("\n")
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => /["'][\w.-]+\/[\w.\-/]+@[0-9a-f]{40}["']/.test(line));
  assertEquals(
    literals,
    [],
    `zuke.ts pins an action by hand; use actionPin(...) instead:\n${
      literals.map(({ no, line }) => `  ${no}: ${line.trim()}`).join("\n")
    }`,
  );
});

Deno.test("every generated workflow pin carries its version comment", async () => {
  // Dependabot rewrites the SHA and the `# vX.Y.Z` beside it together, and its
  // metadata tracks that version. A generated file that dropped the comment
  // would leave the bump with no version to report.
  for await (const entry of Deno.readDir(".github/workflows")) {
    if (!entry.isFile || !/\.ya?ml$/.test(entry.name)) continue;
    const text = await Deno.readTextFile(`.github/workflows/${entry.name}`);
    for (const line of text.split("\n")) {
      if (!/^\s*(?:-\s+)?uses:/.test(line)) continue;
      assertEquals(
        /#\s*v?\d/.test(line),
        true,
        `${entry.name} pins without a version comment: ${line.trim()}`,
      );
    }
  }
});
