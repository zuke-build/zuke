// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "./_assert.ts";
import { GitHubActionsCacheStore } from "../src/github_actions_cache.ts";
import { HttpError } from "../src/http.ts";

const SERVICE = "https://results.test/twirp/" +
  "github.actions.results.api.v1.CacheService/";

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string | Uint8Array;
}

/**
 * A fake `fetch` that records every call and routes it to `handler`, which sees
 * the request's URL and its already-read body.
 */
function fakeFetch(
  handler: (call: Call) => Response,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const raw = init?.body;
    const body = raw instanceof Blob
      ? new Uint8Array(await raw.arrayBuffer())
      : typeof raw === "string"
      ? raw
      : "";
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchFn, calls };
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

Deno.test("GitHubActionsCacheStore.get resolves the signed URL and fetches it", async () => {
  const { fetch, calls } = fakeFetch((call) => {
    if (call.url === `${SERVICE}GetCacheEntryDownloadURL`) {
      return json({
        ok: true,
        signed_download_url: "https://blob.test/entry?sig=1",
        matched_key: "build-abc",
      });
    }
    return new Response(new Uint8Array([1, 2, 3]));
  });
  const store = new GitHubActionsCacheStore({
    url: "https://results.test/", // trailing slash trimmed
    token: "tok",
    fetch,
  });
  const got = await store.get("build-abc");
  assertEquals(got === null ? [] : Array.from(got), [1, 2, 3]);

  const [lookup, download] = calls;
  assertEquals(lookup.method, "POST");
  assertEquals(lookup.headers.get("authorization"), "Bearer tok");
  const body = JSON.parse(String(lookup.body));
  assertEquals(body.key, "build-abc");
  assertEquals(typeof body.version, "string");
  assertEquals(body.version.length, 64); // a hex digest, as the service expects
  // The signed URL carries its own credential: the token is not forwarded.
  assertEquals(download.url, "https://blob.test/entry?sig=1");
  assertEquals(download.headers.get("authorization"), null);
});

Deno.test("GitHubActionsCacheStore.get reads the JSON spelling of the URL too", async () => {
  const { fetch } = fakeFetch((call) =>
    call.url.startsWith(SERVICE)
      ? json({ ok: true, signedDownloadUrl: "https://blob.test/e" })
      : new Response(new Uint8Array([9]))
  );
  const store = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch,
  });
  const got = await store.get("k");
  assertEquals(got === null ? [] : Array.from(got), [9]);
});

Deno.test("GitHubActionsCacheStore.get reports a miss as null", async () => {
  const notOk = fakeFetch(() => json({ ok: false }));
  const store = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch: notOk.fetch,
  });
  assertEquals(await store.get("k"), null);
  assertEquals(notOk.calls.length, 1); // nothing to download

  // An older service answers `not_found`, which Twirp carries as a 404.
  const notFound = fakeFetch(() =>
    json({ code: "not_found", msg: "no entry" }, 404)
  );
  const older = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch: notFound.fetch,
  });
  assertEquals(await older.get("k"), null);

  // A signed URL whose blob has since been evicted is a miss as well.
  const gone = fakeFetch((call) =>
    call.url.startsWith(SERVICE)
      ? json({ ok: true, signed_download_url: "https://blob.test/e" })
      : new Response(null, { status: 404 })
  );
  const evicted = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch: gone.fetch,
  });
  assertEquals(await evicted.get("k"), null);

  // A body that is not an object is treated as an empty answer.
  const odd = fakeFetch(() => json("nope"));
  const oddStore = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch: odd.fetch,
  });
  assertEquals(await oddStore.get("k"), null);
});

Deno.test("GitHubActionsCacheStore.get throws on service and download errors", async () => {
  const service = fakeFetch(() => new Response("boom", { status: 500 }));
  const store = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch: service.fetch,
  });
  const serviceError = await assertRejects(() => store.get("k"));
  assertEquals(serviceError instanceof HttpError, true);

  const download = fakeFetch((call) =>
    call.url.startsWith(SERVICE)
      ? json({ ok: true, signed_download_url: "https://blob.test/e" })
      : new Response("denied", { status: 403 })
  );
  const downloadStore = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch: download.fetch,
  });
  const downloadError = await assertRejects(() => downloadStore.get("k"));
  assertEquals(downloadError instanceof HttpError, true);
});

Deno.test("GitHubActionsCacheStore.get refuses a body over the artifact cap", async () => {
  const { fetch } = fakeFetch((call) =>
    call.url.startsWith(SERVICE)
      ? json({ ok: true, signed_download_url: "https://blob.test/e" })
      : new Response(new Uint8Array(64))
  );
  const store = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch,
    maxArtifactBytes: 16,
  });
  const error = await assertRejects(() => store.get("k"));
  assertStringIncludes(
    error instanceof Error ? error.message : String(error),
    "larger than 16 bytes",
  );
});

Deno.test("GitHubActionsCacheStore.put reserves, uploads, and finalizes", async () => {
  const { fetch, calls } = fakeFetch((call) => {
    if (call.url === `${SERVICE}CreateCacheEntry`) {
      return json({
        ok: true,
        signed_upload_url: "https://blob.test/up?sig=2",
      });
    }
    if (call.url === `${SERVICE}FinalizeCacheEntryUpload`) {
      return json({ ok: true, entry_id: "7" });
    }
    return new Response(null, { status: 201 });
  });
  const store = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch,
  });
  await store.put("k1", new Uint8Array([4, 5, 6]));

  const [reserve, upload, finalize] = calls;
  const reserveBody = JSON.parse(String(reserve.body));
  assertEquals(reserveBody.key, "k1");
  assertEquals(upload.method, "PUT");
  assertEquals(upload.url, "https://blob.test/up?sig=2");
  assertEquals(upload.headers.get("x-ms-blob-type"), "BlockBlob");
  assertEquals(upload.headers.get("authorization"), null);
  assertEquals(
    typeof upload.body === "string" ? [] : Array.from(upload.body),
    [4, 5, 6],
  );
  const finalizeBody = JSON.parse(String(finalize.body));
  assertEquals(finalizeBody.key, "k1");
  assertEquals(finalizeBody.version, reserveBody.version);
  assertEquals(finalizeBody.size_bytes, "3");
});

Deno.test("GitHubActionsCacheStore.put leaves an entry another job finalized", async () => {
  const { fetch, calls } = fakeFetch(() =>
    json({ code: "already_exists", msg: "cache entry exists" }, 409)
  );
  const store = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch,
  });
  await store.put("k", new Uint8Array([1]));
  assertEquals(calls.length, 1); // no upload, no finalize
});

Deno.test("GitHubActionsCacheStore.put throws when a step is refused", async () => {
  const refused = fakeFetch(() => json({ ok: false }));
  const store = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch: refused.fetch,
  });
  const error = await assertRejects(() => store.put("k", new Uint8Array([1])));
  assertStringIncludes(
    error instanceof Error ? error.message : String(error),
    'refused to reserve an entry for "k"',
  );

  const serviceDown = fakeFetch(() => new Response(null, { status: 503 }));
  const downStore = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch: serviceDown.fetch,
  });
  const downError = await assertRejects(() =>
    downStore.put("k", new Uint8Array([1]))
  );
  assertEquals(downError instanceof HttpError, true);

  const uploadFails = fakeFetch((call) =>
    call.url.startsWith(SERVICE)
      ? json({ ok: true, signedUploadUrl: "https://blob.test/up" })
      : new Response(null, { status: 403 })
  );
  const uploadStore = new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch: uploadFails.fetch,
  });
  const uploadError = await assertRejects(() =>
    uploadStore.put("k", new Uint8Array([1]))
  );
  assertEquals(uploadError instanceof HttpError, true);
  assertEquals(uploadFails.calls.length, 2); // never finalized
});
