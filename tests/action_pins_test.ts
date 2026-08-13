// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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

/**
 * Collect pins from `dir` alone, with no manifest.
 *
 * The manifest argument defaults to the repository's own `action.yml`, so a
 * single-argument call would read the real file and make these tests depend on
 * it. Pointing at a path inside the temp directory keeps each case isolated.
 */
function pinsFrom(dir: string): Map<string, { ref: string; version?: string }> {
  return collectActionPins(dir, `${dir}/__no_manifest__.yml`);
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
    const pins = pinsFrom(dir);
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
    assertEquals(pinsFrom(dir).get("actions/checkout"), {
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
      pinsFrom(dir).get("actions/checkout")?.version,
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
      () => pinsFrom(dir),
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
    const pins = pinsFrom(dir);
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
  assertEquals(pinsFrom(dir).size, 0);
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
      pinsFrom(dir).get("actions/checkout")?.ref.endsWith(SHA_A),
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

/**
 * `ai-review.yml` is generated by `@zuke/ai`, whose declared `@zuke/core` floor
 * predates the versioned-pin support — so its pins are SHA-only until that floor
 * moves. Dependabot bumps a comment-less pin regardless (it has already done so
 * for this very file), so the pin stays current either way.
 */
const NO_VERSION_COMMENTS = new Set(["ai-review.yml"]);

Deno.test("every generated workflow pin carries its version comment", async () => {
  // Dependabot rewrites the SHA and the `# vX.Y.Z` beside it together, and its
  // metadata tracks that version. A generated file that dropped the comment
  // would leave the bump with no version to report.
  for await (const entry of Deno.readDir(".github/workflows")) {
    if (!entry.isFile || !/\.ya?ml$/.test(entry.name)) continue;
    if (NO_VERSION_COMMENTS.has(entry.name)) continue;
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

Deno.test("the action.yml manifest outranks a generated workflow", () => {
  // The point of the manifest: the generator never writes it, so a bump landing
  // there cannot be undone by regenerating. A workflow disagreeing with it is
  // not a conflict — it is a file about to be rewritten.
  const dir = Deno.makeTempDirSync();
  const manifest = `${dir}/action.yml`;
  Deno.writeTextFileSync(
    manifest,
    `runs:\n  steps:\n    - uses: actions/checkout@${SHA_B} # v9.9.9\n`,
  );
  const workflows = Deno.makeTempDirSync();
  Deno.writeTextFileSync(
    `${workflows}/ci.yml`,
    `      - uses: actions/checkout@${SHA_A} # v7.0.1\n`,
  );
  try {
    const pins = collectActionPins(workflows, manifest);
    assertEquals(
      pins.get("actions/checkout")?.ref,
      `actions/checkout@${SHA_B}`,
    );
    assertEquals(pins.get("actions/checkout")?.version, "v9.9.9");
  } finally {
    Deno.removeSync(dir, { recursive: true });
    Deno.removeSync(workflows, { recursive: true });
  }
});

Deno.test("a manifest pin silences the disagreement between two workflows", () => {
  // With an authoritative source there is nothing to disagree about — the
  // half-applied-bump error is for when no such source names the action.
  const dir = Deno.makeTempDirSync();
  const manifest = `${dir}/action.yml`;
  Deno.writeTextFileSync(manifest, `    - uses: actions/checkout@${SHA_B}\n`);
  const workflows = Deno.makeTempDirSync();
  Deno.writeTextFileSync(
    `${workflows}/a.yml`,
    `  - uses: actions/checkout@${SHA_A}\n`,
  );
  Deno.writeTextFileSync(
    `${workflows}/b.yml`,
    `  - uses: actions/checkout@${"c".repeat(40)}\n`,
  );
  try {
    assertEquals(
      collectActionPins(workflows, manifest).get("actions/checkout")?.ref,
      `actions/checkout@${SHA_B}`,
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
    Deno.removeSync(workflows, { recursive: true });
  }
});

Deno.test("an absent manifest falls back to the workflows", () => {
  const workflows = Deno.makeTempDirSync();
  Deno.writeTextFileSync(
    `${workflows}/a.yml`,
    `  - uses: actions/checkout@${SHA_A}\n`,
  );
  try {
    assertEquals(
      collectActionPins(workflows, `${workflows}/missing.yml`)
        .get("actions/checkout")?.ref,
      `actions/checkout@${SHA_A}`,
    );
  } finally {
    Deno.removeSync(workflows, { recursive: true });
  }
});

Deno.test("the committed action.yml pins every action the build uses", () => {
  // The manifest is only a useful source for actions it actually names, so a
  // new pinned action must be added there rather than left to the workflows.
  const manifest = Deno.readTextFileSync("action.yml");
  for (const action of ["step-security/harden-runner", "actions/checkout"]) {
    assertStringIncludes(manifest, `uses: ${action}@`);
  }
});

Deno.test("the manifest's own pins resolve from it, not by fallback", () => {
  // Closes the gap in "the manifest is authoritative": a mangled SHA would not
  // match the pin pattern, so the action would quietly fall through to a
  // workflow or the seed and the manifest would stop being the source without
  // anything saying so. Asserting the pins come *from the manifest alone* is
  // what makes an incorrect edit fail loudly here.
  const fromManifest = collectActionPins(
    "__no_workflows__",
    "action.yml",
  );
  for (const action of ["step-security/harden-runner", "actions/checkout"]) {
    const pin = fromManifest.get(action);
    assertEquals(
      pin !== undefined,
      true,
      `${action} is not pinned in action.yml`,
    );
    const sha = pin?.ref.split("@")[1] ?? "";
    assertEquals(
      /^[0-9a-f]{40}$/.test(sha),
      true,
      `${action} has no full 40-character SHA in action.yml: ${sha}`,
    );
    // The version comment is what Dependabot rewrites alongside the SHA.
    assertEquals(
      /^v?\d/.test(pin?.version ?? ""),
      true,
      `${action} has no version comment in action.yml`,
    );
  }
});
