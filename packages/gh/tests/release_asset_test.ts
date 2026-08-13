// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the release-asset upload. The requests go through a `fetch`
 * seam: the release lookup is answered the way the REST API does (including
 * the RFC 6570 `upload_url` template), so what is asserted is the real
 * two-step flow — resolve the release, then POST the bytes to the upload host.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { GhTasks } from "../mod.ts";

/** A recorded request the fake `fetch` saw. */
interface Seen {
  url: string;
  method: string;
  authorization: string;
  contentType: string | null;
  body: Uint8Array | undefined;
}

/** A release lookup payload like the REST API's, parameterized on its assets. */
function releasePayload(assets: { name: string }[]): Record<string, unknown> {
  return {
    id: 77,
    tag_name: "core-v1.2.3",
    upload_url:
      "https://uploads.github.com/repos/acme/app/releases/77/assets{?name,label}",
    assets: assets.map((a, i) => ({
      id: 100 + i,
      name: a.name,
      browser_download_url:
        `https://github.com/acme/app/releases/download/core-v1.2.3/${a.name}`,
    })),
  };
}

/** A `fetch` seam answering the lookup and the upload like GitHub does. */
function fakeGithub(
  seen: Seen[],
  options: { releaseStatus?: number; assets?: { name: string }[] } = {},
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const rawBody = init?.body;
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? "",
      contentType: headers.get("content-type"),
      body: rawBody instanceof Uint8Array ? rawBody : undefined,
    });
    if (String(input).includes("uploads.github.com")) {
      return new Response(
        JSON.stringify({
          id: 900,
          name: "asset",
          browser_download_url:
            "https://github.com/acme/app/releases/download/core-v1.2.3/asset",
        }),
        { status: 201, statusText: "Created" },
      );
    }
    const status = options.releaseStatus ?? 200;
    const payload = status < 300
      ? releasePayload(options.assets ?? [])
      : { message: "Not Found" };
    await Promise.resolve();
    return new Response(JSON.stringify(payload), {
      status,
      statusText: status < 300 ? "OK" : "Not Found",
    });
  };
}

/** Write a small file to upload and return its path. */
async function assetFixture(dir: string): Promise<string> {
  const path = `${dir}/extension.tar.gz`;
  await Deno.writeFile(path, new Uint8Array([1, 2, 3, 4]));
  return path;
}

/** Run `fn` with the Actions environment variables set to `values`. */
async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    saved.set(name, Deno.env.get(name));
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
  try {
    await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test("an asset is uploaded to the latest release's upload host", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    const seen: Seen[] = [];
    const result = await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).repo("acme/app").token("tok").fetch(fakeGithub(seen))
    );

    assertEquals(result.state, "uploaded");
    assertEquals(result.releaseTag, "core-v1.2.3");
    assertEquals(result.releaseId, 77);

    // First the lookup, then the upload — with the template cut off, the name
    // in the query, the token on both, and the file's actual bytes as body.
    assertEquals(seen.length, 2);
    assertStringIncludes(seen[0].url, "/repos/acme/app/releases/latest");
    assertEquals(
      seen[1].url,
      "https://uploads.github.com/repos/acme/app/releases/77/assets" +
        "?name=extension.tar.gz",
    );
    assertEquals(seen[1].method, "POST");
    assertEquals(seen[1].authorization, "Bearer tok");
    assertEquals(seen[1].contentType, "application/gzip");
    assertEquals(seen[1].body, new Uint8Array([1, 2, 3, 4]));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a tag setting resolves that release instead of latest", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    const seen: Seen[] = [];
    await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).tag("v1.0.0").repo("acme/app").token("tok")
        .fetch(fakeGithub(seen))
    );
    assertStringIncludes(seen[0].url, "/repos/acme/app/releases/tags/v1.0.0");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an asset the release already carries is kept, not re-sent", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    const seen: Seen[] = [];
    const result = await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).repo("acme/app").token("tok")
        .fetch(fakeGithub(seen, { assets: [{ name: "extension.tar.gz" }] }))
    );
    assertEquals(result.state, "already-exists");
    assertStringIncludes(result.url ?? "", "extension.tar.gz");
    // Only the lookup went out — published assets are never churned.
    assertEquals(seen.length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a repository with no releases reports no-release, not an error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    const result = await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).repo("acme/app").token("tok")
        .fetch(fakeGithub([], { releaseStatus: 404 }))
    );
    assertEquals(result, { state: "no-release", name: "extension.tar.gz" });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a missing tag IS an error — the caller named a release", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    await assertRejects(
      () =>
        GhTasks.uploadReleaseAsset((s) =>
          s.file(file).tag("v9.9.9").repo("acme/app").token("tok")
            .fetch(fakeGithub([], { releaseStatus: 404 }))
        ),
      Error,
      "releases/tags/v9.9.9",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the name, content type, and their defaults follow the file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    const seen: Seen[] = [];
    await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).name("bundle.zip").contentType("application/x-test")
        .repo("acme/app").token("tok").fetch(fakeGithub(seen))
    );
    assertStringIncludes(seen[1].url, "?name=bundle.zip");
    assertEquals(seen[1].contentType, "application/x-test");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("missing settings fail with messages that name the fix", async () => {
  await assertRejects(
    () => GhTasks.uploadReleaseAsset((s) => s.repo("a/b").token("t")),
    Error,
    ".file(...)",
  );
  await withEnv(
    { GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined },
    async () => {
      await assertRejects(
        () =>
          GhTasks.uploadReleaseAsset((s) =>
            s.file("x.bin").repo("a/b").fetch(() => {
              throw new Error("no request should be made without a token");
            })
          ),
        Error,
        ".token(...)",
      );
      await assertRejects(
        () => GhTasks.uploadReleaseAsset((s) => s.file("x.bin").token("t")),
        Error,
        "GITHUB_REPOSITORY",
      );
    },
  );
});

Deno.test("the token and repo default to the Actions environment", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    await withEnv(
      { GITHUB_TOKEN: "ghs_env", GITHUB_REPOSITORY: "acme/app" },
      async () => {
        const seen: Seen[] = [];
        await GhTasks.uploadReleaseAsset((s) =>
          s.file(file).fetch(fakeGithub(seen))
        );
        assertStringIncludes(seen[0].url, "/repos/acme/app/releases/latest");
        // The token rides in the header from the environment, never argv.
        assertEquals(seen[0].authorization, "Bearer ghs_env");
      },
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a GHES base URL is honored, trailing slash and all", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    const seen: Seen[] = [];
    await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).name("asset.bin").repo("acme/app").token("tok")
        .baseUrl("https://ghes.example/api/v3/").fetch(fakeGithub(seen))
    );
    assertStringIncludes(
      seen[0].url,
      "https://ghes.example/api/v3/repos/acme/app/releases/latest",
    );
    // An unknown extension falls back to the generic content type.
    assertEquals(seen[1].contentType, "application/octet-stream");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a name that cannot be derived from the file asks for .name(...)", async () => {
  await assertRejects(
    () =>
      GhTasks.uploadReleaseAsset((s) =>
        s.file("dist/").repo("a/b").token("t").fetch(fakeGithub([]))
      ),
    Error,
    ".name(...)",
  );
});

Deno.test("malformed release responses fail with what came back", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    const answering = (body: string): typeof fetch => async () => {
      await Promise.resolve();
      return new Response(body, { status: 200 });
    };
    // A proxy answering instead of GitHub: not JSON at all.
    await assertRejects(
      () =>
        GhTasks.uploadReleaseAsset((s) =>
          s.file(file).repo("a/b").token("t").fetch(answering("<html>"))
        ),
      Error,
      "non-JSON body",
    );
    // JSON, but not a release: nothing to upload to.
    await assertRejects(
      () =>
        GhTasks.uploadReleaseAsset((s) =>
          s.file(file).repo("a/b").token("t").fetch(answering("{}"))
        ),
      Error,
      "no id/upload_url",
    );
    // The lookup succeeds but the upload host answers garbage.
    const brokenUpload: typeof fetch = async (input) => {
      await Promise.resolve();
      if (String(input).includes("uploads.github.com")) {
        return new Response("<html>", { status: 201 });
      }
      return new Response(JSON.stringify(releasePayload([])), { status: 200 });
    };
    await assertRejects(
      () =>
        GhTasks.uploadReleaseAsset((s) =>
          s.file(file).repo("a/b").token("t").fetch(brokenUpload)
        ),
      Error,
      "non-JSON body",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an upload rejection surfaces GitHub's own message", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    const failing: typeof fetch = async (input) => {
      await Promise.resolve();
      if (String(input).includes("uploads.github.com")) {
        return new Response(JSON.stringify({ message: "asset too large" }), {
          status: 422,
          statusText: "Unprocessable Entity",
        });
      }
      return new Response(JSON.stringify(releasePayload([])), { status: 200 });
    };
    await assertRejects(
      () =>
        GhTasks.uploadReleaseAsset((s) =>
          s.file(file).repo("acme/app").token("tok").fetch(failing)
        ),
      Error,
      "asset too large",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
