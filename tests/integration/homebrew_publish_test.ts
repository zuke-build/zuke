// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `HomebrewTasks.publish` driven through a real build:
 * the first run commits the rendered formula into the tap, and a second run of
 * the same build commits nothing — the idempotency a release pipeline that
 * publishes on every run depends on. GitHub is an in-memory fake behind the
 * `fetch` seam, holding the tap's files between the two runs.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import {
  type HomebrewPublishResult,
  HomebrewTasks,
} from "../../packages/homebrew/mod.ts";
import { runCli } from "./_harness.ts";

/** The git blob SHA of `text`, as GitHub reports a file's. */
async function blobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const bytes = new Uint8Array([
    ...new TextEncoder().encode(`blob ${body.length}\0`),
    ...body,
  ]);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A contents API holding files in memory, recording every write. */
function fakeContents(): { fetch: typeof fetch; writes: string[] } {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if ((init?.method ?? "GET") === "GET") {
      const content = files.get(path);
      return content === undefined
        ? new Response("{}", { status: 404 })
        : Response.json({ type: "file", sha: await blobSha(content) });
    }
    const body = JSON.parse(String(init?.body));
    const content = atob(body.content);
    files.set(path, content);
    writes.push(path);
    return Response.json({
      commit: { sha: `commit-${writes.length}` },
      content: { sha: await blobSha(content) },
    }, { status: 201 });
  };
  return { fetch: impl, writes };
}

Deno.test("homebrew: publishing the same formula twice commits once", async () => {
  const github = fakeContents();
  const results: HomebrewPublishResult[] = [];

  class Release extends Build {
    publish = target().description("publish the formula").executes(
      async () => {
        const ruby = HomebrewTasks.formula((s) =>
          s.name("app").description("Widget tool")
            .homepage("https://example.com").version("1.2.3")
            .binary((b) =>
              b.os("macos").arch("arm").url("https://example.com/a.tgz")
                .sha256("0".repeat(64))
            )
            .install("app")
        );
        results.push(
          await HomebrewTasks.publish((s) =>
            s.tap("acme/tap").formula("app", ruby).token("t")
              .message("app 1.2.3").fetch(github.fetch)
          ),
        );
      },
    );
  }

  assertEquals((await runCli(Release, ["publish"])).code, 0);
  assertEquals((await runCli(Release, ["publish"])).code, 0);
  assertEquals(results.map((result) => result.state), [
    "created",
    "unchanged",
  ]);
  assertEquals(results[0].commitSha, "commit-1");
  assertEquals(github.writes, [
    "/repos/acme/homebrew-tap/contents/Formula/app.rb",
  ]);
});
