// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the Gemini extension release archive. What matters is the
 * contract Gemini's installer imposes: `gemini-extension.json` at the archive
 * root, the asset names platform-prefixed so `findReleaseAsset` matches them
 * deterministically, and byte-stable output so re-attaching to a release is
 * meaningfully idempotent.
 *
 * @module
 */

import { gunzip, untar } from "../packages/core/mod.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import {
  buildGeminiArchive,
  GEMINI_ASSET_NAMES,
  geminiArchiveFiles,
} from "../build/gemini_archive.ts";
import { withTemp } from "../packages/core/tests/_temp.ts";

/** Lay out a minimal extension root (manifest, license, two skills). */
async function extensionFixture(): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${root}/gemini-extension.json`,
    '{"name":"zuke","version":"0.0.1"}',
  );
  await Deno.writeTextFile(`${root}/LICENSE`, "MIT");
  await Deno.mkdir(`${root}/skills/b-skill`, { recursive: true });
  await Deno.writeTextFile(`${root}/skills/b-skill/SKILL.md`, "b");
  await Deno.mkdir(`${root}/skills/a-skill/references`, { recursive: true });
  await Deno.writeTextFile(`${root}/skills/a-skill/SKILL.md`, "a");
  await Deno.writeTextFile(`${root}/skills/a-skill/references/notes.md`, "n");
  return root;
}

Deno.test("the file list is the manifest, license, and skills — sorted", async () => {
  const root = await extensionFixture();
  try {
    assertEquals(await geminiArchiveFiles(root), [
      "gemini-extension.json",
      "LICENSE",
      "skills/a-skill/SKILL.md",
      "skills/a-skill/references/notes.md",
      "skills/b-skill/SKILL.md",
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("the archive round-trips with the manifest at its root", async () => {
  const root = await extensionFixture();
  try {
    const dest = `${root}/out.tar.gz`;
    await buildGeminiArchive(dest, root);
    const entries = untar(await gunzip(await Deno.readFile(dest)));
    const names = entries.map((e) => e.name);
    // Gemini requires the manifest at the archive root — no wrapper directory.
    assertEquals(names[0], "gemini-extension.json");
    assertEquals(names.includes("skills/a-skill/SKILL.md"), true);
    const manifest = entries.find((e) => e.name === "gemini-extension.json");
    assertStringIncludes(
      new TextDecoder().decode(manifest?.data ?? new Uint8Array()),
      '"name":"zuke"',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("two builds of the same tree are byte-identical", async () => {
  // The release upload is skip-if-present; that is only meaningful when a
  // rebuild produces the same bytes rather than a fresh timestamped archive.
  const root = await extensionFixture();
  try {
    await buildGeminiArchive(`${root}/one.tar.gz`, root);
    await buildGeminiArchive(`${root}/two.tar.gz`, root);
    assertEquals(
      await Deno.readFile(`${root}/one.tar.gz`),
      await Deno.readFile(`${root}/two.tar.gz`),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("the asset names are platform-prefixed the way Gemini matches", () => {
  // `findReleaseAsset` matches `{platform}.`-prefixed names case-insensitively
  // and only falls back to a generic asset when it is alone on the release —
  // so every supported `os.platform()` value must have its own prefix.
  assertEquals(GEMINI_ASSET_NAMES.length, 3);
  for (const platform of ["darwin", "linux", "win32"]) {
    assertEquals(
      GEMINI_ASSET_NAMES.some((n) => n.startsWith(`${platform}.`)),
      true,
      `no asset name for ${platform}`,
    );
  }
  for (const name of GEMINI_ASSET_NAMES) {
    assertEquals(name.endsWith(".tar.gz"), true, `${name} is not a .tar.gz`);
  }
});

Deno.test("a broken extension root fails with errors that name the fix", async () => {
  await withTemp(async (root) => {
    // No manifest at all.
    await assertRejects(
      () => geminiArchiveFiles(root),
      Error,
      "requires gemini-extension.json",
    );
    await Deno.writeTextFile(`${root}/gemini-extension.json`, "{}");
    await assertRejects(() => geminiArchiveFiles(root), Error, "LICENSE");
    await Deno.writeTextFile(`${root}/LICENSE`, "MIT");
    // Manifest and license present, but no skills tree.
    await assertRejects(
      () => geminiArchiveFiles(root),
      Error,
      "requires a skills/ tree",
    );
  });
});

Deno.test({
  name: "a symlink under skills/ is refused, not silently dropped",
  // Creating symlinks on Windows needs a privilege the CI runner may lack.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    // Git and the other harnesses would keep the linked content; an archive
    // that silently loses it would ship different skills to Gemini.
    const root = await extensionFixture();
    try {
      await Deno.symlink(
        `${root}/skills/a-skill/SKILL.md`,
        `${root}/skills/a-skill/linked.md`,
      );
      await assertRejects(
        () => geminiArchiveFiles(root),
        Error,
        "linked.md",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test("the repo's real tree packs cleanly", async () => {
  // The actual release-time operation, run against this repository: the
  // manifest, license, and both skills pack without hitting tar's 100-byte
  // name limit.
  await withTemp(async (dir) => {
    const packed = await buildGeminiArchive(`${dir}/zuke.tar.gz`);
    assertEquals(packed[0], "gemini-extension.json");
    assertEquals(packed.includes("skills/zuke-setup/SKILL.md"), true);
    assertEquals(packed.includes("skills/zuke-write-build/SKILL.md"), true);
  });
});
