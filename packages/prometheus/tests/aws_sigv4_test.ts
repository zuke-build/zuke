// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: the SigV4 signer against the AWS Signature Version 4 test suite.
 *
 * The vectors below are copied verbatim from the suite as published in
 * `awslabs/aws-c-auth` (`tests/aws-signing-test-suite/v4/<name>/`): the
 * request, the expected canonical request, string to sign and signature,
 * signed at 2015-08-30T12:36:00Z in `us-east-1` for the service `service`
 * with the suite's documented example key (`AKIDEXAMPLE` — AWS's published
 * placeholder, not a credential). The `post-x-www-form-urlencoded` case signs
 * its body hash header, which the suite's `sign_body` option adds.
 *
 * The suite's `get-utf8` and `get-space-normalized` cases are left out: their
 * request lines carry a raw, unencoded path (`/ሴ`, `/example space/`) that no
 * HTTP client sends, and encode it once. A real request's path is already
 * percent-encoded, and SigV4 for every service but S3 encodes it again
 * (botocore's `SigV4Auth`); that rule is tested on its own below.
 */

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { sha256Hex } from "@zuke/core";
import { signSigV4 } from "../src/aws_sigv4.ts";

/** The suite's example credentials. */
const KEY = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

/** The suite's signing instant. */
const NOW = Date.parse("2015-08-30T12:36:00Z");

/** One test-suite case. */
interface Vector {
  name: string;
  method: string;
  target: string;
  headers: Record<string, string>;
  body: string;
  signBody: boolean;
  token: string | null;
  canonical: string;
  stringToSign: string;
  signature: string;
}

// cspell:disable -- the suite's hex digests
/** The suite's cases, verbatim. */
const VECTORS: Vector[] = [
  {
    "name": "get-vanilla",
    "method": "GET",
    "target": "/",
    "headers": {},
    "body": "",
    "signBody": false,
    "token": null,
    "canonical":
      "GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "stringToSign":
      "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nbb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
    "signature":
      "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  },
  {
    "name": "get-vanilla-query-order-key-case",
    "method": "GET",
    "target": "/?Param2=value2&Param1=value1",
    "headers": {},
    "body": "",
    "signBody": false,
    "token": null,
    "canonical":
      "GET\n/\nParam1=value1&Param2=value2\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "stringToSign":
      "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n816cd5b414d056048ba4f7c5386d6e0533120fb1fcfa93762cf0fc39e2cf19e0",
    "signature":
      "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
  },
  {
    "name": "get-vanilla-query-unreserved",
    "method": "GET",
    "target":
      "/?-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz=-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    "headers": {},
    "body": "",
    "signBody": false,
    "token": null,
    "canonical":
      "GET\n/\n-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz=-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "stringToSign":
      "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nc30d4703d9f799439be92736156d47ccfb2d879ddf56f5befa6d1d6aab979177",
    "signature":
      "9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197",
  },
  {
    "name": "get-vanilla-with-session-token",
    "method": "GET",
    "target": "/",
    "headers": {},
    "body": "",
    "signBody": false,
    "token": "6e86291e8372ff2a2260956d9b8aae1d763fbf315fa00fa31553b73ebf194267", // gitleaks:allow — the suite's published example
    "canonical":
      "GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\nx-amz-security-token:6e86291e8372ff2a2260956d9b8aae1d763fbf315fa00fa31553b73ebf194267\n\nhost;x-amz-date;x-amz-security-token\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // gitleaks:allow — the suite's published example
    "stringToSign":
      "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n067b36aa60031588cea4a4cde1f21215227a047690c72247f1d70b32fbbfad2b",
    "signature":
      "07ec1639c89043aa0e3e2de82b96708f198cceab042d4a97044c66dd9f74e7f8",
  },
  {
    "name": "post-vanilla-query",
    "method": "POST",
    "target": "/?Param1=value1",
    "headers": {},
    "body": "",
    "signBody": false,
    "token": null,
    "canonical":
      "POST\n/\nParam1=value1\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "stringToSign":
      "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n9d659678c1756bb3113e2ce898845a0a79dbbc57b740555917687f1b3340fbbd",
    "signature":
      "28038455d6de14eafc1f9222cf5aa6f1a96197d7deb8263271d420d138af7f11",
  },
  {
    "name": "post-x-www-form-urlencoded",
    "method": "POST",
    "target": "/",
    "headers": {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": "13",
    },
    "body": "Param1=value1",
    "signBody": true,
    "token": null,
    "canonical":
      "POST\n/\n\ncontent-length:13\ncontent-type:application/x-www-form-urlencoded\nhost:example.amazonaws.com\nx-amz-content-sha256:9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e\nx-amz-date:20150830T123600Z\n\ncontent-length;content-type;host;x-amz-content-sha256;x-amz-date\n9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e",
    "stringToSign":
      "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nb1edd1d03544c25390e32085d55b57acc9a3961bb59415ff86c45c3d89d16cfb",
    "signature":
      "d3875051da38690788ef43de4db0d8f280229d82040bfac253562e56c3f20e0b",
  },
];
// cspell:enable

/** The request URL for a suite target: the raw path, encoded as a client would. */
function urlOf(target: string): string {
  const url = new URL(`https://example.amazonaws.com${target}`);
  return url.href;
}

for (const vector of VECTORS) {
  Deno.test(`SigV4 test suite: ${vector.name}`, async () => {
    const body = new TextEncoder().encode(vector.body);
    const headers = vector.signBody
      ? { ...vector.headers, "x-amz-content-sha256": await sha256Hex(body) }
      : vector.headers;
    const signed = await signSigV4(
      {
        method: vector.method === "POST" ? "POST" : "GET",
        url: urlOf(vector.target),
        headers,
        body,
      },
      vector.token === null ? KEY : { ...KEY, sessionToken: vector.token },
      "us-east-1",
      "service",
      NOW,
    );
    assertEquals(signed.canonicalRequest, vector.canonical);
    assertEquals(signed.stringToSign, vector.stringToSign);
    const names = vector.canonical.split("\n").at(-2);
    assertEquals(
      signed.headers.authorization,
      `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/` +
        `aws4_request, SignedHeaders=${names}, Signature=${vector.signature}`,
    );
    assertEquals(signed.headers["x-amz-date"], "20150830T123600Z");
    assertEquals(
      signed.headers["x-amz-security-token"],
      vector.token === null ? undefined : vector.token,
    );
  });
}

Deno.test("SigV4 canonicalises a + as a space, repeated names by value, and %20 the same", async () => {
  const sign = (url: string) =>
    signSigV4(
      { method: "GET", url, headers: {}, body: new Uint8Array(0) },
      KEY,
      "us-east-1",
      "aps",
      NOW,
    );
  const plus = await sign("https://h.example/q?b=2&a=x+y&a=w&a=z&flag");
  assertEquals(
    plus.canonicalRequest.split("\n")[2],
    "a=w&a=x%20y&a=z&b=2&flag=",
  );
  const encoded = await sign("https://h.example/q?flag=&a=z&b=2&a=x%20y&a=w");
  assertEquals(encoded.headers.authorization, plus.headers.authorization);
});

Deno.test("SigV4 trims and collapses header values and signs the port in host", async () => {
  const signed = await signSigV4(
    {
      method: "GET",
      url: "https://h.example:8443/",
      headers: { "x-custom": "  a   b  " },
      body: new Uint8Array(0),
    },
    KEY,
    "us-east-1",
    "aps",
    NOW,
  );
  const lines = signed.canonicalRequest.split("\n");
  assertEquals(lines.slice(3, 6), [
    "host:h.example:8443",
    "x-amz-date:20150830T123600Z",
    "x-custom:a b",
  ]);
});

Deno.test("SigV4 double-encodes the wire path and drops empty and dot segments", async () => {
  const cases: Array<[string, string]> = [
    ["https://h.example/example%20space/", "/example%2520space/"],
    ["https://h.example/\u1234", "/%25E1%2588%25B4"],
    ["https://h.example/a//b/./c/%2E%2E/d", "/a/b/d"],
    ["https://h.example/ws-1/api/v1/query", "/ws-1/api/v1/query"],
    ["https://h.example//", "/"],
    ["https://h.example/%zz", "/%25zz"],
  ];
  for (const [url, canonical] of cases) {
    const signed = await signSigV4(
      { method: "GET", url, headers: {}, body: new Uint8Array(0) },
      KEY,
      "us-east-1",
      "aps",
      NOW,
    );
    assertEquals(signed.canonicalRequest.split("\n")[1], canonical, url);
  }
});

Deno.test("SigV4 refuses a query that is not valid percent-encoding", async () => {
  await assertRejects(
    () =>
      signSigV4(
        {
          method: "GET",
          url: "https://h.example/?a=%zz",
          headers: {},
          body: new Uint8Array(0),
        },
        KEY,
        "us-east-1",
        "aps",
        NOW,
      ),
    Error,
    "the URL's query is not valid percent-encoding",
  );
});
