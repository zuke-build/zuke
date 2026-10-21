// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "./_assert.ts";
import { S3CacheStore } from "../src/s3_cache.ts";
import { signSigV4 } from "../src/aws_sigv4.ts";
import { sha256Hex } from "../src/internal.ts";
import { HttpError } from "../src/http.ts";

/** The AWS test suite's example key: a published placeholder, not a credential. */
const KEY = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};
const NOW = Date.parse("2015-08-30T12:36:00Z");

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: Uint8Array;
}

function fakeFetch(
  handler: (call: Call) => Response,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body instanceof Blob
        ? new Uint8Array(await init.body.arrayBuffer())
        : new Uint8Array(0),
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchFn, calls };
}

const store = (fetchFn: typeof fetch, sessionToken?: string) =>
  new S3CacheStore({
    url: "https://bucket.s3.eu-west-1.amazonaws.com/zuke-cache/",
    region: "eu-west-1",
    credentials: sessionToken === undefined ? KEY : { ...KEY, sessionToken },
    fetch: fetchFn,
    now: () => NOW,
  });

Deno.test("S3CacheStore.get signs the request and returns the bytes", async () => {
  const { fetch, calls } = fakeFetch(() =>
    new Response(new Blob([new Uint8Array([1, 2, 3])]))
  );
  const got = await store(fetch).get("build-abc");
  assertEquals(got === null ? [] : Array.from(got), [1, 2, 3]);

  const [call] = calls;
  assertEquals(
    call.url,
    "https://bucket.s3.eu-west-1.amazonaws.com/zuke-cache/build-abc",
  );
  assertEquals(call.headers.get("x-amz-date"), "20150830T123600Z");
  assertEquals(
    call.headers.get("x-amz-content-sha256"),
    await sha256Hex(new Uint8Array(0)),
  );
  // The same signature the signer produces for the request as sent, scoped to
  // the service s3 in the configured region.
  const expected = await signSigV4(
    {
      method: "GET",
      url: call.url,
      headers: { "x-amz-content-sha256": await sha256Hex(new Uint8Array(0)) },
      body: new Uint8Array(0),
    },
    KEY,
    "eu-west-1",
    "s3",
    NOW,
  );
  assertEquals(
    call.headers.get("authorization"),
    expected.headers.authorization,
  );
  assertEquals(
    call.headers.get("authorization")?.includes(
      "Credential=AKIDEXAMPLE/20150830/eu-west-1/s3/aws4_request",
    ),
    true,
  );
});

Deno.test("S3CacheStore.put signs the body hash and sends the session token", async () => {
  const { fetch, calls } = fakeFetch(() => new Response(null, { status: 200 }));
  const artifact = new Uint8Array([9, 8, 7]);
  await store(fetch, "session-token").put("k1", artifact);

  const [call] = calls;
  assertEquals(call.method, "PUT");
  assertEquals(Array.from(call.body), [9, 8, 7]);
  assertEquals(
    call.headers.get("x-amz-content-sha256"),
    await sha256Hex(artifact),
  );
  assertEquals(call.headers.get("x-amz-security-token"), "session-token");
  // Every header sent is signed, the content hash and the blob type included.
  const signedHeaders = call.headers.get("authorization")?.match(
    /SignedHeaders=([^,]+)/,
  )?.[1];
  assertEquals(
    signedHeaders,
    "content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-ms-blob-type",
  );
});

Deno.test("S3CacheStore reports a 404 as a miss and other errors as errors", async () => {
  const miss = fakeFetch(() => new Response(null, { status: 404 }));
  assertEquals(await store(miss.fetch).get("nope"), null);

  // Without s3:ListBucket a missing key is a 403, which is not a miss.
  const denied = fakeFetch(() => new Response("denied", { status: 403 }));
  const err = await assertRejects(() => store(denied.fetch).get("nope"));
  assertEquals(err instanceof HttpError, true);
});
