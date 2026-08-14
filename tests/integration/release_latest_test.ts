// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the release target's Latest-pointer wiring — pin the
 * repository's "Latest release" back onto the action's release, then refresh
 * the extension archive it carries — driven through the real CLI against a
 * fake GitHub, mirroring how `zuke.ts`'s `release` target is wired.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { GhTasks } from "../../packages/gh/mod.ts";
import { runCli } from "./_harness.ts";

/**
 * A fake GitHub mid-churn: the action release exists on its tag (unless the
 * test says otherwise), but the pointer sits on a package release — as it
 * does after any release-please run — and the action release carries a stale
 * archive.
 */
function fakeGithub(
  calls: string[],
  options: { tagStatus?: number } = {},
): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${new URL(url).pathname}`);
    await Promise.resolve();
    if (method === "PATCH") {
      return new Response(JSON.stringify({ id: 7 }), { status: 200 });
    }
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (new URL(url).hostname === "uploads.example") {
      return new Response(
        JSON.stringify({ id: 901, browser_download_url: "dl/fresh" }),
        { status: 201 },
      );
    }
    if (url.includes("/releases/tags/v1.0.2")) {
      if (options.tagStatus !== undefined && options.tagStatus >= 400) {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: options.tagStatus,
        });
      }
      return new Response(
        JSON.stringify({
          id: 7,
          tag_name: "v1.0.2",
          upload_url: "https://uploads.example/assets{?name,label}",
          assets: [{
            id: 55,
            name: "zuke.tar.gz",
            digest: "sha256:" + "0".repeat(64),
            browser_download_url: "dl/stale",
          }],
        }),
        { status: 200 },
      );
    }
    // The latest lookup: a package release holds the pointer.
    return new Response(
      JSON.stringify({ id: 9, tag_name: "ai-v2.2.0" }),
      { status: 200 },
    );
  };
}

/** A fixture build wired like the release target's Latest-pointer step. */
function releaseBuild(
  root: string,
  calls: string[],
  options: { tagStatus?: number } = {},
) {
  class Release extends Build {
    pinLatest = target().executes(async () => {
      const latest = await GhTasks.markReleaseLatest((s) =>
        s.tag("v1.0.2").repo("acme/app").token("tok")
          .fetch(fakeGithub(calls, options))
      );
      console.log(`latest: ${latest.state}`);
      // As in the release target: in the window where the action tag exists
      // but its release is not yet cut, attach nothing — an upload resolved
      // any other way could touch a package release's assets.
      if (latest.state === "no-release") {
        console.log("archive: skipped");
        return;
      }
      const archive = `${root}/zuke.tar.gz`;
      await Deno.writeFile(archive, new Uint8Array([9, 9, 9]));
      const asset = await GhTasks.uploadReleaseAsset((s) =>
        s.file(archive).tag("v1.0.2").repo("acme/app").token("tok").refresh()
          .fetch(fakeGithub(calls, options))
      );
      console.log(`archive: ${asset.state}`);
    });
  }
  return Release;
}

Deno.test("the release wiring pins Latest back and refreshes the archive", async () => {
  const root = await Deno.makeTempDir();
  try {
    const calls: string[] = [];
    const { code, out } = await runCli(releaseBuild(root, calls), [
      "pinLatest",
    ]);
    assertEquals(code, 0);

    // The pointer was on a package release, so the run moved it — and the
    // stale archive on the pinned release was replaced, not kept.
    assertStringIncludes(out, "latest: marked");
    assertStringIncludes(out, "archive: refreshed");
    assertEquals(calls, [
      "GET /repos/acme/app/releases/tags/v1.0.2",
      "GET /repos/acme/app/releases/latest",
      "PATCH /repos/acme/app/releases/7",
      "GET /repos/acme/app/releases/tags/v1.0.2",
      "DELETE /repos/acme/app/releases/assets/55",
      "POST /assets",
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("the not-yet-cut release window writes nowhere at all", async () => {
  // Regression: with the pointer on a package release and the action release
  // not yet cut, a refresh resolved through "latest" would have deleted and
  // replaced assets on that package release. The wiring must stop after the
  // no-release answer — no PATCH, no DELETE, no upload.
  const root = await Deno.makeTempDir();
  try {
    const calls: string[] = [];
    const { code, out } = await runCli(
      releaseBuild(root, calls, { tagStatus: 404 }),
      ["pinLatest"],
    );
    assertEquals(code, 0);
    assertStringIncludes(out, "latest: no-release");
    assertStringIncludes(out, "archive: skipped");
    assertEquals(calls, ["GET /repos/acme/app/releases/tags/v1.0.2"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
