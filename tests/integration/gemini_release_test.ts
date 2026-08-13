// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the release target's Gemini-asset wiring — build the extension
 * archive, then attach it to the latest release under each platform-prefixed
 * name — driven through the real CLI against a fake GitHub, mirroring how
 * `zuke.ts`'s `release` target is wired (see `build/gemini_archive.ts`).
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { GhTasks } from "../../packages/gh/mod.ts";
import {
  buildGeminiArchive,
  GEMINI_ASSET_NAMES,
} from "../../build/gemini_archive.ts";
import { runCli } from "./_harness.ts";

/** A fake GitHub: one release, remembering the asset names it accepts. */
function fakeGithub(uploaded: string[]): typeof fetch {
  return async (input, _init) => {
    await Promise.resolve();
    const url = String(input);
    if (new URL(url).hostname === "uploads.example") {
      const name = new URL(url).searchParams.get("name") ?? "";
      uploaded.push(name);
      return new Response(
        JSON.stringify({ id: 1, name, browser_download_url: `dl/${name}` }),
        { status: 201 },
      );
    }
    return new Response(
      JSON.stringify({
        id: 9,
        tag_name: "core-v1.0.0",
        upload_url: "https://uploads.example/assets{?name,label}",
        // The first name is already attached, as after a partial earlier run.
        assets: [{
          id: 5,
          name: GEMINI_ASSET_NAMES[0],
          browser_download_url: "dl/existing",
        }],
      }),
      { status: 200 },
    );
  };
}

/** A fixture build wired like the release target's Gemini-asset step. */
function releaseBuild(root: string, uploaded: string[]) {
  class Release extends Build {
    attach = target().executes(async () => {
      const archive = `${root}/zuke.tar.gz`;
      await buildGeminiArchive(archive, root);
      for (const name of GEMINI_ASSET_NAMES) {
        const result = await GhTasks.uploadReleaseAsset((s) =>
          s.file(archive).name(name).repo("acme/app").token("tok")
            .fetch(fakeGithub(uploaded))
        );
        console.log(`${name}: ${result.state}`);
      }
    });
  }
  return Release;
}

Deno.test("the release wiring attaches missing assets and keeps existing ones", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${root}/gemini-extension.json`,
      '{"name":"zuke","version":"0.0.1"}',
    );
    await Deno.writeTextFile(`${root}/LICENSE`, "MIT");
    await Deno.mkdir(`${root}/skills/s`, { recursive: true });
    await Deno.writeTextFile(`${root}/skills/s/SKILL.md`, "s");

    const uploaded: string[] = [];
    const { code, out } = await runCli(releaseBuild(root, uploaded), [
      "attach",
    ]);
    assertEquals(code, 0);

    // The asset present from the earlier run is kept; the other two upload.
    assertStringIncludes(out, `${GEMINI_ASSET_NAMES[0]}: already-exists`);
    assertStringIncludes(out, `${GEMINI_ASSET_NAMES[1]}: uploaded`);
    assertStringIncludes(out, `${GEMINI_ASSET_NAMES[2]}: uploaded`);
    assertEquals(uploaded, GEMINI_ASSET_NAMES.slice(1));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
