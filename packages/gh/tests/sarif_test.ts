// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the code-scanning SARIF upload. The request goes through a
 * `fetch` seam and the body is decoded back (base64 → gunzip → JSON) so the
 * encoding the endpoint requires is actually asserted, not assumed.
 *
 * @module
 */

import { gunzip } from "@zuke/core";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { GhTasks } from "../mod.ts";
import { withTemp } from "../../core/tests/_temp.ts";
import { withEnv } from "../../core/tests/_env.ts";

/** A recorded request the fake `fetch` saw. */
interface Seen {
  url: string;
  method: string;
  authorization: string;
  body: Record<string, string>;
}

/** A `fetch` seam that records the request and answers as code scanning does. */
function fakeGithub(seen: Seen[], status = 202): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === "string" ? init.body : "{}";
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? "",
      body: JSON.parse(raw),
    });
    const payload = status < 300
      ? { id: "upload-1", url: "https://api.github.com/…/sarifs/upload-1" }
      : { message: "sarif is invalid" };
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        statusText: status < 300 ? "Accepted" : "Bad Request",
      }),
    );
  };
}

/** The SARIF JSON that was actually sent, decoded from the request body. */
async function sentSarif(seen: Seen): Promise<unknown> {
  const binary = atob(seen.body.sarif);
  const packed = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) packed[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(await gunzip(packed)));
}

/** Write a minimal SARIF report to a temp file and return its path. */
async function sarifFixture(dir: string): Promise<string> {
  const path = `${dir}/results.sarif`;
  await Deno.writeTextFile(
    path,
    JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
  );
  return path;
}

Deno.test("uploadSarif gzips and base64s the report the endpoint requires", async () => {
  await withTemp(async (dir) => {
    const file = await sarifFixture(dir);
    const seen: Seen[] = [];
    const result = await GhTasks.uploadSarif((s) =>
      s
        .file(file)
        .repo("zuke-build/zuke")
        .commit("a".repeat(40))
        .ref("refs/heads/master")
        .token("ghs_x")
        .fetch(fakeGithub(seen))
    );

    assertEquals(result, {
      id: "upload-1",
      url: "https://api.github.com/…/sarifs/upload-1",
    });
    assertEquals(
      seen[0].url,
      "https://api.github.com/repos/zuke-build/zuke/code-scanning/sarifs",
    );
    assertEquals(seen[0].method, "POST");
    assertEquals(seen[0].authorization, "Bearer ghs_x");
    assertEquals(seen[0].body.commit_sha, "a".repeat(40));
    assertEquals(seen[0].body.ref, "refs/heads/master");
    // The report survives the round trip — the encoding is right, not just present.
    assertEquals(await sentSarif(seen[0]), {
      version: "2.1.0",
      runs: [{ results: [] }],
    });
  });
});

Deno.test("uploadSarif fills the repo, commit, ref, and token from the Actions env", async () => {
  await withTemp(async (dir) => {
    const file = await sarifFixture(dir);
    await withEnv({
      GITHUB_REPOSITORY: "acme/app",
      GITHUB_SHA: "b".repeat(40),
      GITHUB_REF: "refs/heads/main",
      GITHUB_TOKEN: "ghs_env",
    }, async () => {
      const seen: Seen[] = [];
      await GhTasks.uploadSarif((s) => s.file(file).fetch(fakeGithub(seen)));
      assertStringIncludes(seen[0].url, "/repos/acme/app/code-scanning/sarifs");
      assertEquals(seen[0].body.commit_sha, "b".repeat(40));
      assertEquals(seen[0].body.ref, "refs/heads/main");
      // The token rides in the header from the environment, never through argv.
      assertEquals(seen[0].authorization, "Bearer ghs_env");
    });
  });
});

Deno.test("checkout_uri is sent only when it is set", async () => {
  await withTemp(async (dir) => {
    const file = await sarifFixture(dir);
    const seen: Seen[] = [];
    const pinned = (path: string) => (s: GhSarifSettingsLike) =>
      s.file(path).repo("a/b").commit("c").ref("d").token("t").fetch(
        fakeGithub(seen),
      );

    await GhTasks.uploadSarif(pinned(file));
    assertEquals("checkout_uri" in seen[0].body, false);

    await GhTasks.uploadSarif((s) =>
      pinned(file)(s).checkoutUri("file:///checkout")
    );
    assertEquals(seen[1].body.checkout_uri, "file:///checkout");
  });
});

/** The subset of the settings the shared `pinned` helper above configures. */
type GhSarifSettingsLike = Parameters<
  NonNullable<Parameters<typeof GhTasks.uploadSarif>[0]>
>[0];

Deno.test("uploadSarif names each missing input instead of sending a partial body", async () => {
  await withTemp(async (dir) => {
    const file = await sarifFixture(dir);
    await withEnv({
      GITHUB_REPOSITORY: undefined,
      GITHUB_SHA: undefined,
      GITHUB_REF: undefined,
    }, async () => {
      await assertRejects(
        () => GhTasks.uploadSarif((s) => s.repo("a/b").token("t")),
        Error,
        ".file(...)",
      );
      await assertRejects(
        () => GhTasks.uploadSarif((s) => s.file(file).token("t")),
        Error,
        ".repo('owner/name')",
      );
      await assertRejects(
        () => GhTasks.uploadSarif((s) => s.file(file).repo("a/b").token("t")),
        Error,
        "GITHUB_SHA",
      );
      await assertRejects(
        () =>
          GhTasks.uploadSarif((s) =>
            s.file(file).repo("a/b").commit("c").token("t")
          ),
        Error,
        "GITHUB_REF",
      );
    });
  });
});

Deno.test("a missing token names the permission the upload needs", async () => {
  await withEnv({ GITHUB_TOKEN: undefined }, async () => {
    await assertRejects(
      () =>
        GhTasks.uploadSarif((s) =>
          s.file("unread.sarif").repo("a/b").commit("c").ref("d")
        ),
      Error,
      "security-events: write",
    );
  });
});

Deno.test("a rejected upload reports the status and GitHub's message", async () => {
  await withTemp(async (dir) => {
    const file = await sarifFixture(dir);
    const error = await assertRejects(
      () =>
        GhTasks.uploadSarif((s) =>
          s.file(file).repo("a/b").commit("c").ref("d").token("t")
            .fetch(fakeGithub([], 400))
        ),
      Error,
    );
    assertStringIncludes(
      error.message,
      "POST /code-scanning/sarifs failed: 400",
    );
    assertStringIncludes(error.message, "sarif is invalid");
  });
});

Deno.test("a repository that is not owner/name is refused before anything is sent", async () => {
  // The slug is interpolated into the request path, so `..` in it would send a
  // write-scoped token somewhere the caller never named. The upload routes
  // through the shared caller, which is what checks it — before the report is
  // even read.
  await assertRejects(
    () =>
      GhTasks.uploadSarif((s) =>
        s.file("unread.sarif").repo("../../orgs/victim").commit("c").ref("d")
          .token("t").fetch(() => {
            throw new Error("no request should be made");
          })
      ),
    Error,
    'invalid repository "../../orgs/victim"',
  );
});
