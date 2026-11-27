// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { GitHubActionsCacheStore } from "../src/github_actions_cache.ts";
import { HttpCacheStore } from "../src/remote_cache.ts";
import { S3CacheStore } from "../src/s3_cache.ts";
import { HttpError } from "../src/http.ts";
import { partsOf, uploadInParts } from "../src/part_upload.ts";
import { isAzureSasUrl } from "../src/azure_blob.ts";
import { signSigV4 } from "../src/aws_sigv4.ts";
import { trimTrailingSlashes } from "../src/internal.ts";

const MIB = 1024 * 1024;
const PART = 8 * MIB;

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: Uint8Array;
}

/** A fake `fetch` that records every call, bodies read, and routes to `handler`. */
function fakeFetch(
  handler: (call: Call) => Response,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const raw = init?.body;
    const call: Call = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: raw instanceof Blob
        ? new Uint8Array(await raw.arrayBuffer())
        : new TextEncoder().encode(typeof raw === "string" ? raw : ""),
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchFn, calls };
}

/** A stream of `n` bytes all equal to `value`, in chunks of `chunk` bytes. */
function bytes(
  n: number,
  value = 0,
  chunk = MIB,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let left = n;
  return new ReadableStream({
    pull(controller) {
      const size = Math.min(chunk, left);
      left -= size;
      if (size > 0) controller.enqueue(new Uint8Array(size).fill(value));
      if (left === 0) controller.close();
    },
  });
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("partsOf cuts at exact and inexact boundaries, across chunk edges", async () => {
  const sizes = async (n: number, chunk: number) => {
    const stream = bytes(n, 0, chunk);
    const out: number[] = [];
    for await (const part of partsOf(stream, 4)) out.push(part.length);
    return out;
  };
  assertEquals(await sizes(0, 3), []);
  assertEquals(await sizes(4, 3), [4]);
  assertEquals(await sizes(8, 3), [4, 4]);
  assertEquals(await sizes(9, 3), [4, 4, 1]);
  assertEquals(await sizes(3, 10), [3]);
});

test("uploadInParts sends one part or less whole, and more in order", async () => {
  const run = async (n: number) => {
    const seen: string[] = [];
    await uploadInParts(
      bytes(n),
      (bytes) => {
        seen.push(`whole:${bytes.length}`);
        return Promise.resolve();
      },
      async (parts) => {
        for await (const part of parts) seen.push(`part:${part.length}`);
      },
    );
    return seen;
  };
  assertEquals(await run(0), ["whole:0"]);
  assertEquals(await run(PART), [`whole:${PART}`]);
  assertEquals(await run(PART + 1), [`part:${PART}`, "part:1"]);
  assertEquals(await run(2 * PART), [`part:${PART}`, `part:${PART}`]);
});

// --- S3 ---------------------------------------------------------------------

const KEY = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};
const OBJECT = "https://bucket.s3.eu-west-1.amazonaws.com/zuke-cache/k";

const s3 = (fetchFn: typeof fetch) =>
  new S3CacheStore({
    url: "https://bucket.s3.eu-west-1.amazonaws.com/zuke-cache/",
    region: "eu-west-1",
    credentials: KEY,
    fetch: fetchFn,
    now: () => Date.parse("2015-08-30T12:36:00Z"),
  });

/** A bucket that answers the multipart protocol; `fail` can break one step. */
function multipartBucket(
  fail: (call: Call) => Response | undefined = () => undefined,
) {
  return fakeFetch((call) => {
    const broken = fail(call);
    if (broken !== undefined) return broken;
    if (call.url.endsWith("?uploads")) {
      return new Response(
        "<InitiateMultipartUploadResult><UploadId>up/1</UploadId>" +
          "</InitiateMultipartUploadResult>",
      );
    }
    if (call.method === "PUT") {
      const n = new URL(call.url).searchParams.get("partNumber");
      return new Response(null, { headers: { etag: `"e${n}"` } });
    }
    return new Response("<CompleteMultipartUploadResult/>");
  });
}

test("S3CacheStore.putStream uploads 8 MiB parts and completes them in order", async () => {
  const { fetch, calls } = multipartBucket();
  await s3(fetch).putStream("k", bytes(PART + 1));

  assertEquals(calls.map((c) => c.method), ["POST", "PUT", "PUT", "POST"]);
  assertEquals(calls[0].url, `${OBJECT}?uploads`);
  assertEquals(calls[1].url, `${OBJECT}?partNumber=1&uploadId=up%2F1`);
  assertEquals(calls[2].url, `${OBJECT}?partNumber=2&uploadId=up%2F1`);
  assertEquals(calls[3].url, `${OBJECT}?uploadId=up%2F1`);
  assertEquals([calls[1].body.length, calls[2].body.length], [PART, 1]);
  for (const part of [calls[1], calls[2]]) {
    assertEquals(part.headers.get("x-amz-content-sha256"), "UNSIGNED-PAYLOAD");
    assertEquals(part.headers.has("authorization"), true);
  }
  assertEquals(
    text(calls[3].body),
    "<CompleteMultipartUpload>" +
      '<Part><PartNumber>1</PartNumber><ETag>"e1"</ETag></Part>' +
      '<Part><PartNumber>2</PartNumber><ETag>"e2"</ETag></Part>' +
      "</CompleteMultipartUpload>",
  );
});

test("S3CacheStore.putStream splits an exact multiple without an empty part", async () => {
  const { fetch, calls } = multipartBucket();
  await s3(fetch).putStream("k", bytes(2 * PART));
  assertEquals(
    calls.filter((c) => c.method === "PUT").map((c) => c.body.length),
    [PART, PART],
  );
});

test("S3CacheStore.putStream sends one part or less as a single signed PUT", async () => {
  const { fetch, calls } = fakeFetch(() => new Response(null));
  await s3(fetch).putStream("k", bytes(PART));
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, OBJECT);
  assertEquals(calls[0].body.length, PART);
  assertEquals(
    calls[0].headers.get("x-amz-content-sha256") === "UNSIGNED-PAYLOAD",
    false,
  );
});

test("S3CacheStore.putStream aborts the upload when a part fails", async () => {
  const { fetch, calls } = multipartBucket((c) =>
    c.url.includes("partNumber=2")
      ? new Response(null, { status: 500 })
      : undefined
  );
  const err = await assertRejects(() =>
    s3(fetch).putStream("k", bytes(2 * PART + 1))
  );
  assertEquals(err instanceof HttpError, true);
  const last = calls[calls.length - 1];
  assertEquals(
    [last.method, last.url],
    ["DELETE", `${OBJECT}?uploadId=up%2F1`],
  );
  assertEquals(calls.length, 4); // create, two parts, abort: never completed
});

test("S3CacheStore.putStream aborts when completion answers 200 with an error", async () => {
  const { fetch, calls } = multipartBucket((c) =>
    c.method === "POST" && c.url.endsWith("uploadId=up%2F1")
      ? new Response("<Error><Code>InternalError</Code></Error>")
      : undefined
  );
  await assertRejects(() => s3(fetch).putStream("k", bytes(PART + 1)));
  assertEquals(calls[calls.length - 1].method, "DELETE");
});

test("S3CacheStore.putStream aborts when completion is refused, and keeps the cause if the abort fails", async () => {
  const { fetch, calls } = multipartBucket((c) =>
    c.method === "DELETE"
      ? new Response(null, { status: 500 })
      : c.method === "POST" && c.url.endsWith("uploadId=up%2F1")
      ? new Response(null, { status: 403 })
      : undefined
  );
  const err = await assertRejects(() =>
    s3(fetch).putStream("k", bytes(PART + 1))
  );
  assertEquals(err instanceof HttpError && err.status === 403, true);
  assertEquals(calls[calls.length - 1].method, "DELETE");
});

test("S3CacheStore.putStream refuses a response without an upload id or an ETag", async () => {
  const noId = fakeFetch(() => new Response("<x/>"));
  await assertRejects(() => s3(noId.fetch).putStream("k", bytes(PART + 1)));
  assertEquals(noId.calls.length, 1); // nothing to abort

  const { fetch, calls } = multipartBucket((c) =>
    c.method === "PUT" ? new Response(null) : undefined
  );
  await assertRejects(() => s3(fetch).putStream("k", bytes(PART + 1)));
  assertEquals(calls[calls.length - 1].method, "DELETE");
});

// --- GitHub Actions cache ---------------------------------------------------

const SERVICE = "https://results.test/twirp/" +
  "github.actions.results.api.v1.CacheService/";

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status });

/** A cache service whose upload URL is on `blob.test`. */
function cacheService(blobStatus: (url: URL) => number = () => 201) {
  return fakeFetch((call) => {
    if (call.url === `${SERVICE}CreateCacheEntry`) {
      return json({
        ok: true,
        signed_upload_url: "https://blob.test/up?sig=2",
      });
    }
    if (call.url.startsWith(SERVICE)) return json({ ok: true });
    return new Response(null, { status: blobStatus(new URL(call.url)) });
  });
}

const gha = (fetchFn: typeof fetch) =>
  new GitHubActionsCacheStore({
    url: "https://results.test",
    token: "t",
    fetch: fetchFn,
  });

const comp = (call: Call) => new URL(call.url).searchParams.get("comp");

test("GitHubActionsCacheStore.putStream uploads blocks, commits them, and finalizes the summed size", async () => {
  const { fetch, calls } = cacheService();
  await gha(fetch).putStream("k1", bytes(2 * PART + 5));

  const blobs = calls.filter((c) => c.url.startsWith("https://blob.test/"));
  assertEquals(blobs.map(comp), ["block", "block", "block", "blocklist"]);
  const ids = blobs.slice(0, 3).map((c) =>
    new URL(c.url).searchParams.get("blockid")
  );
  assertEquals(ids.map((id) => atob(String(id)).slice(36)), [
    "00000000",
    "00000001",
    "00000002",
  ]);
  assertEquals(new Set(ids.map((id) => String(id).length)).size, 1);
  assertEquals(String(ids[0]).length <= 64, true); // Azure's id limit
  assertEquals(blobs[0].url.includes("sig=2"), true); // the SAS is kept
  assertEquals(blobs[0].headers.get("authorization"), null);
  assertEquals(blobs.slice(0, 3).map((c) => c.body.length), [PART, PART, 5]);
  assertEquals(
    text(blobs[3].body),
    '<?xml version="1.0" encoding="utf-8"?><BlockList>' +
      ids.map((id) => `<Latest>${id}</Latest>`).join("") + "</BlockList>",
  );
  const finalize = calls[calls.length - 1];
  assertEquals(finalize.url, `${SERVICE}FinalizeCacheEntryUpload`);
  assertEquals(
    JSON.parse(text(finalize.body)).size_bytes,
    String(2 * PART + 5),
  );
});

test("GitHubActionsCacheStore.putStream splits an exact multiple into two blocks", async () => {
  const { fetch, calls } = cacheService();
  await gha(fetch).putStream("k", bytes(2 * PART));
  assertEquals(calls.filter((c) => comp(c) === "block").length, 2);
  assertEquals(
    JSON.parse(text(calls[calls.length - 1].body)).size_bytes,
    String(2 * PART),
  );
});

test("GitHubActionsCacheStore.putStream sends one part or less as a single Put Blob", async () => {
  const { fetch, calls } = cacheService();
  await gha(fetch).putStream("k", bytes(PART));
  assertEquals(calls[1].url, "https://blob.test/up?sig=2");
  assertEquals(calls[1].headers.get("x-ms-blob-type"), "BlockBlob");
  assertEquals(calls.length, 3); // reserve, upload, finalize
});

test("GitHubActionsCacheStore.putStream never finalizes when a block or the list fails", async () => {
  for (const failing of ["block", "blocklist"]) {
    const { fetch, calls } = cacheService((u) =>
      u.searchParams.get("comp") === failing ? 500 : 201
    );
    const err = await assertRejects(() =>
      gha(fetch).putStream("k", bytes(PART + 1))
    );
    assertEquals(err instanceof HttpError, true);
    assertEquals(
      calls.some((c) => c.url.endsWith("FinalizeCacheEntryUpload")),
      false,
    );
  }
});

test("GitHubActionsCacheStore.putStream leaves an entry another job finalized", async () => {
  const { fetch, calls } = fakeFetch(() =>
    json({ code: "already_exists" }, 409)
  );
  await gha(fetch).putStream("k", bytes(PART + 1));
  assertEquals(calls.length, 1);
});

// --- HTTP store -------------------------------------------------------------

const AZURE = "https://acct.blob.core.windows.net/container?sv=1&sig=abc";

test("HttpCacheStore.putStream uploads an Azure SAS URL in blocks and commits them", async () => {
  const { fetch, calls } = fakeFetch(() => new Response(null, { status: 201 }));
  const store = new HttpCacheStore({
    url: AZURE,
    token: "t",
    headers: { "x-extra": "1" },
    fetch,
  });
  await store.putStream("k1", bytes(PART + 1));

  const urls = calls.map((c) => new URL(c.url));
  assertEquals(urls.map((u) => u.searchParams.get("comp")), [
    "block",
    "block",
    "blocklist",
  ]);
  assertEquals(urls[0].pathname, "/container/k1");
  assertEquals(urls[0].searchParams.get("sig"), "abc");
  assertEquals(
    atob(String(urls[0].searchParams.get("blockid"))).slice(36),
    "00000000",
  );
  assertEquals(
    atob(String(urls[1].searchParams.get("blockid"))).slice(36),
    "00000001",
  );
  assertEquals(calls[0].headers.get("authorization"), "Bearer t");
  assertEquals(calls[0].headers.get("x-extra"), "1");
});

test("HttpCacheStore.putStream sends a small Azure archive as one Put Blob", async () => {
  const { fetch, calls } = fakeFetch(() => new Response(null, { status: 201 }));
  await new HttpCacheStore({ url: AZURE, fetch }).putStream("k", bytes(10));
  assertEquals(calls.length, 1);
  assertEquals(new URL(calls[0].url).searchParams.has("comp"), false);
});

test("HttpCacheStore.putStream fails when an Azure block is refused", async () => {
  const { fetch } = fakeFetch(() => new Response(null, { status: 403 }));
  const err = await assertRejects(() =>
    new HttpCacheStore({ url: AZURE, fetch }).putStream("k", bytes(PART + 1))
  );
  assertEquals(err instanceof HttpError, true);
});

test("HttpCacheStore.putStream buffers into one PUT for any other server", async () => {
  const { fetch, calls } = fakeFetch(() => new Response(null, { status: 201 }));
  await new HttpCacheStore({ url: "https://cache.test", fetch }).putStream(
    "k",
    bytes(PART + 1),
  );
  assertEquals(calls.length, 1);
  assertEquals(
    [calls[0].method, calls[0].url],
    ["PUT", "https://cache.test/k"],
  );
  assertEquals(calls[0].body.length, PART + 1);
});

test("concurrent Azure uploads to one blob never commit a mix of the two archives", async () => {
  // Models Azure: Put Block stores an uncommitted block by id, overwriting one
  // with the same id; Put Block List commits the listed ids. Upload A (bytes
  // of 1) sends two blocks, then waits while upload B (bytes of 2) runs to its
  // commit, then finishes: with ids shared between uploads, A's commit would
  // list B's first two blocks under A's ids.
  const uncommitted = new Map<string, number>();
  let committed: number[] = [];
  let aBlocks = 0;
  let bCommitted: () => void = () => {};
  const bDone = new Promise<void>((resolve) => bCommitted = resolve);
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body;
    if (!(body instanceof Blob)) throw new Error("expected a Blob body");
    if (url.searchParams.get("comp") === "block") {
      const first = new Uint8Array(await body.slice(0, 1).arrayBuffer())[0];
      if (first === 1 && ++aBlocks === 3) await bDone;
      uncommitted.set(String(url.searchParams.get("blockid")), first);
    } else {
      const ids = [
        ...(await body.text()).matchAll(/<Latest>([^<]+)<\/Latest>/g),
      ]
        .map((m) => m[1]);
      committed = ids.map((id) => {
        const first = uncommitted.get(id);
        if (first === undefined) throw new Error("uncommitted block listed");
        return first;
      });
      bCommitted();
    }
    return new Response(null, { status: 201 });
  };
  const store = new HttpCacheStore({ url: AZURE, fetch: fetchFn });
  await Promise.all([
    store.putStream("k", bytes(2 * PART + 5, 1)),
    store.putStream("k", bytes(2 * PART + 5, 2)),
  ]);
  // A committed last, and what it committed is A's archive alone.
  assertEquals(committed, [1, 1, 1]);
});

test("S3CacheStore.putStream aborts and rethrows when the source stream fails", async () => {
  const { fetch, calls } = multipartBucket();
  let sent = 0;
  const failing = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (sent === 2 * PART) return controller.error(new Error("disk gone"));
      sent += MIB;
      controller.enqueue(new Uint8Array(MIB));
    },
  });
  const err = await assertRejects(() => s3(fetch).putStream("k", failing));
  assertEquals(err instanceof Error && err.message, "disk gone");
  assertEquals(calls[calls.length - 1].method, "DELETE");
});

test("uploadInParts releases the source stream when the upload stops early", async () => {
  let cancelled = false;
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      controller.enqueue(new Uint8Array(MIB));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assertRejects(() =>
    uploadInParts(
      source,
      () => Promise.resolve(),
      () => Promise.reject(new Error("409")),
    )
  );
  assertEquals(cancelled, true);
});

test("isAzureSasUrl accepts a blob SAS URL and rejects lookalikes", () => {
  assertEquals(isAzureSasUrl(AZURE), true);
  assertEquals(isAzureSasUrl("https://acct.blob.core.windows.net/c"), false); // no sig
  assertEquals(
    isAzureSasUrl("https://evil-blob.core.windows.net.attacker.com/c?sig=1"),
    false,
  );
  assertEquals(
    isAzureSasUrl("https://evilblob.core.windows.net.x/c?sig=1"),
    false,
  );
  assertEquals(isAzureSasUrl("not a url"), false);
});

test("SigV4 signs UNSIGNED-PAYLOAD without hashing the body when the header says so", async () => {
  const sign = (body: Uint8Array, hash: string) =>
    signSigV4(
      {
        method: "PUT",
        url: "https://b.s3.amazonaws.com/k",
        headers: { "x-amz-content-sha256": hash },
        body,
      },
      KEY,
      "eu-west-1",
      "s3",
      Date.parse("2015-08-30T12:36:00Z"),
    );
  const a = await sign(new Uint8Array([1]), "UNSIGNED-PAYLOAD");
  const b = await sign(new Uint8Array([2, 3]), "UNSIGNED-PAYLOAD");
  assertEquals(a.canonicalRequest.endsWith("\nUNSIGNED-PAYLOAD"), true);
  assertEquals(a.headers.authorization, b.headers.authorization); // body ignored
  const hashed = await sign(new Uint8Array([1]), "anything-else");
  assertEquals(hashed.canonicalRequest.endsWith("\nUNSIGNED-PAYLOAD"), false);
});

test("trimTrailingSlashes drops every trailing slash and nothing else", () => {
  assertEquals(trimTrailingSlashes("https://h/b///"), "https://h/b");
  assertEquals(trimTrailingSlashes("https://h/b"), "https://h/b");
  assertEquals(trimTrailingSlashes("///"), "");
  assertEquals(
    trimTrailingSlashes(`${"/".repeat(100_000)}x`),
    `${"/".repeat(100_000)}x`,
  );
});
