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
import { withTemp } from "../../core/tests/_temp.ts";
import { withEnv } from "../../core/tests/_env.ts";

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
    if (new URL(String(input)).hostname === "uploads.github.com") {
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

Deno.test("an asset is uploaded to the latest release's upload host", async () => {
  await withTemp(async (dir) => {
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
  });
});

Deno.test("a tag setting resolves that release instead of latest", async () => {
  await withTemp(async (dir) => {
    const file = await assetFixture(dir);
    const seen: Seen[] = [];
    await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).tag("v1.0.0").repo("acme/app").token("tok")
        .fetch(fakeGithub(seen))
    );
    assertStringIncludes(seen[0].url, "/repos/acme/app/releases/tags/v1.0.0");
  });
});

Deno.test("an asset the release already carries is kept, not re-sent", async () => {
  await withTemp(async (dir) => {
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
  });
});

Deno.test("a stuck asset (state not uploaded) is deleted and re-sent", async () => {
  // GitHub's documented failure mode: an errored/interrupted upload reserves
  // the asset name in a non-`uploaded` state. Skipping it would leave the
  // release serving a corpse forever — the one case a re-run must repair.
  await withTemp(async (dir) => {
    const file = await assetFixture(dir);
    const seen: Seen[] = [];
    const github: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      seen.push({
        url: String(input),
        method,
        authorization: new Headers(init?.headers).get("authorization") ?? "",
        contentType: new Headers(init?.headers).get("content-type"),
        body: init?.body instanceof Uint8Array ? init.body : undefined,
      });
      await Promise.resolve();
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (new URL(String(input)).hostname === "uploads.github.com") {
        return new Response(
          JSON.stringify({ id: 901, browser_download_url: "dl/fresh" }),
          { status: 201 },
        );
      }
      const release = releasePayload([]);
      release.assets = [{
        id: 55,
        name: "extension.tar.gz",
        state: "new",
        browser_download_url: "dl/corpse",
      }];
      return new Response(JSON.stringify(release), { status: 200 });
    };

    const result = await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).repo("acme/app").token("tok").fetch(github)
    );
    assertEquals(result.state, "uploaded");
    // Lookup, then DELETE of the stuck asset, then the fresh upload.
    assertEquals(seen.map((s) => s.method), ["GET", "DELETE", "POST"]);
    assertStringIncludes(seen[1].url, "/releases/assets/55");
  });
});

Deno.test("a failed deletion of a stuck asset surfaces, a 404 does not", async () => {
  await withTemp(async (dir) => {
    const file = await assetFixture(dir);
    const github = (deleteStatus: number): typeof fetch => async (i, init) => {
      await Promise.resolve();
      if ((init?.method ?? "GET") === "DELETE") {
        return new Response(JSON.stringify({ message: "locked" }), {
          status: deleteStatus,
        });
      }
      if (new URL(String(i)).hostname === "uploads.github.com") {
        return new Response(JSON.stringify({ id: 1 }), { status: 201 });
      }
      const release = releasePayload([]);
      release.assets = [{ id: 55, name: "extension.tar.gz", state: "new" }];
      return new Response(JSON.stringify(release), { status: 200 });
    };
    await assertRejects(
      () =>
        GhTasks.uploadReleaseAsset((s) =>
          s.file(file).repo("acme/app").token("tok").fetch(github(423))
        ),
      Error,
      "locked",
    );
    // The corpse already being gone is the goal state, not a failure.
    const result = await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).repo("acme/app").token("tok").fetch(github(404))
    );
    assertEquals(result.state, "uploaded");
  });
});

/** The `sha256:<hex>` digest the REST API would report for `data`. */
async function digestOf(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

Deno.test("refresh replaces an asset whose digest differs", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    const seen: Seen[] = [];
    const github: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      seen.push({
        url: String(input),
        method,
        authorization: new Headers(init?.headers).get("authorization") ?? "",
        contentType: new Headers(init?.headers).get("content-type"),
        body: init?.body instanceof Uint8Array ? init.body : undefined,
      });
      await Promise.resolve();
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (new URL(String(input)).hostname === "uploads.github.com") {
        return new Response(
          JSON.stringify({ id: 901, browser_download_url: "dl/fresh" }),
          { status: 201 },
        );
      }
      const release = releasePayload([]);
      release.assets = [{
        id: 100,
        name: "extension.tar.gz",
        digest:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        browser_download_url: "dl/stale",
      }];
      return new Response(JSON.stringify(release), { status: 200 });
    };

    const result = await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).repo("acme/app").token("tok").refresh().fetch(github)
    );
    assertEquals(result.state, "refreshed");
    // Lookup, then DELETE of the stale copy, then the fresh upload — the
    // asset's freshness is the caller's declared contract for this name.
    assertEquals(seen.map((s) => s.method), ["GET", "DELETE", "POST"]);
    assertStringIncludes(seen[1].url, "/releases/assets/100");
    assertEquals(seen[2].body, new Uint8Array([1, 2, 3, 4]));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("refresh keeps an asset whose digest matches the file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    const digest = await digestOf(new Uint8Array([1, 2, 3, 4]));
    const seen: Seen[] = [];
    const github: typeof fetch = async (input, init) => {
      seen.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: "",
        contentType: null,
        body: undefined,
      });
      await Promise.resolve();
      const release = releasePayload([]);
      release.assets = [{
        id: 100,
        name: "extension.tar.gz",
        digest,
        browser_download_url: "dl/current",
      }];
      return new Response(JSON.stringify(release), { status: 200 });
    };
    const result = await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).repo("acme/app").token("tok").refresh().fetch(github)
    );
    assertEquals(result.state, "already-exists");
    // Only the lookup went out: same bytes, nothing to replace.
    assertEquals(seen.length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("refresh keeps an asset whose digest the API does not report", async () => {
  // Without a comparison to trust, replacing would churn the release's
  // assets on every run — the exact thing the default protects against.
  const dir = await Deno.makeTempDir();
  try {
    const file = await assetFixture(dir);
    const seen: Seen[] = [];
    const result = await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).repo("acme/app").token("tok").refresh()
        .fetch(fakeGithub(seen, { assets: [{ name: "extension.tar.gz" }] }))
    );
    assertEquals(result.state, "already-exists");
    assertEquals(seen.length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a repository with no releases reports no-release, not an error", async () => {
  await withTemp(async (dir) => {
    const file = await assetFixture(dir);
    const result = await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).repo("acme/app").token("tok")
        .fetch(fakeGithub([], { releaseStatus: 404 }))
    );
    assertEquals(result, { state: "no-release", name: "extension.tar.gz" });
  });
});

Deno.test("a missing tag IS an error — the caller named a release", async () => {
  await withTemp(async (dir) => {
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
  });
});

Deno.test("the name, content type, and their defaults follow the file", async () => {
  await withTemp(async (dir) => {
    const file = await assetFixture(dir);
    const seen: Seen[] = [];
    await GhTasks.uploadReleaseAsset((s) =>
      s.file(file).name("bundle.zip").contentType("application/x-test")
        .repo("acme/app").token("tok").fetch(fakeGithub(seen))
    );
    assertStringIncludes(seen[1].url, "?name=bundle.zip");
    assertEquals(seen[1].contentType, "application/x-test");
  });
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
  await withTemp(async (dir) => {
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
  });
});

Deno.test("a GHES base URL is honored, trailing slash and all", async () => {
  await withTemp(async (dir) => {
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
  });
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
  await withTemp(async (dir) => {
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
      "is not JSON",
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
      if (new URL(String(input)).hostname === "uploads.github.com") {
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
  });
});

Deno.test("a repository that is not owner/name is refused before anything is sent", async () => {
  // The slug is interpolated into the release lookup's path, so `..` in it
  // would send a `contents: write` token somewhere the caller never named. The
  // repo-relative calls route through the shared caller, which checks it.
  await assertRejects(
    () =>
      GhTasks.uploadReleaseAsset((s) =>
        s.file("unread.bin").repo("../../orgs/victim").token("t").fetch(() => {
          throw new Error("no request should be made");
        })
      ),
    Error,
    'invalid repository "../../orgs/victim"',
  );
});

Deno.test("an upload rejection surfaces GitHub's own message", async () => {
  await withTemp(async (dir) => {
    const file = await assetFixture(dir);
    const failing: typeof fetch = async (input) => {
      await Promise.resolve();
      if (new URL(String(input)).hostname === "uploads.github.com") {
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
  });
});
