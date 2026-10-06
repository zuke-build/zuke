// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: the token-endpoint transport every built-in credential source uses —
 * the metadata-endpoint allowlist (and its bypass attempts), redirects, the
 * size cap, error details, and that no secret reaches an error.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { InsecureBackendUrlError } from "@zuke/core";
import {
  answerSeconds,
  answerString,
  type AuthRequest,
  authRequest,
  authRequestJson,
  type AuthStep,
  readAuthFile,
} from "../src/auth_http.ts";
import { context } from "./_auth.ts";
import { fakeFetch } from "./_fetch.ts";

/** The step every test request is named by. */
const STEP: AuthStep = {
  provider: "test",
  step: "the token request",
  secrets: ["secret-value-1234"],
};

/** A GET to `url` answered by `respond`. */
function get(
  url: string,
  respond: () => Response | Promise<Response>,
  env: Record<string, string> = {},
) {
  const fetcher = fakeFetch(respond);
  return {
    fetcher,
    result: authRequest(context({ env, fetch: fetcher }), STEP, {
      method: "GET",
      url,
      headers: {},
    }),
  };
}

Deno.test("the link-local metadata endpoints are the only plaintext ones allowed", async () => {
  for (
    const url of [
      "http://metadata.google.internal/computeMetadata/v1/x",
      "http://169.254.169.254/latest/api/token",
      "http://169.254.170.2/v2/credentials/abc",
      "http://169.254.170.23/v1/credentials",
      "http://[fd00:ec2::23]/v1/credentials",
      "http://localhost:8080/token",
      "https://login.example/token",
    ]
  ) {
    const { result } = get(url, () => new Response("ok"));
    assertEquals(await result, "ok");
  }
  for (
    const url of [
      "http://169.254.169.254.evil.example/latest/api/token",
      "http://169.254.169.254@evil.example/latest/api/token",
      "http://evil.example/?169.254.169.254",
      "http://169.254.169.254:8080/latest/api/token",
      "http://metadata.google.internal.evil.example/token",
      "http://metadata.google.internal:8080/token",
      "http://169.254.169.253/token",
      "http://[fd00:ec2::24]/v1/credentials",
      "http://login.example/token",
    ]
  ) {
    const { fetcher, result } = get(url, () => new Response("ok"));
    await assertRejects(
      () => result,
      InsecureBackendUrlError,
      "the test credential endpoint for the token request must use https",
    );
    assertEquals(fetcher.sent.length, 0, url);
  }
});

Deno.test("ZUKE_ALLOW_INSECURE_URL opens a plaintext token endpoint, as it does the server", async () => {
  const { result } = get(
    "http://login.example/token",
    () => new Response("ok"),
    { ZUKE_ALLOW_INSECURE_URL: "1" },
  );
  assertEquals(await result, "ok");
});

Deno.test("a malformed endpoint is refused without quoting it", async () => {
  const { result } = get("not a url secret-value-1234", () => new Response());
  const error = await assertRejects(() => result, Error, "is not a valid URL");
  assertEquals(error.message.includes("secret-value-1234"), false);
});

Deno.test("the request is sent as given, with the caller's signal and no redirect following", async () => {
  const signal = new AbortController().signal;
  const fetcher = fakeFetch(() => new Response("ok"));
  await authRequest(context({ fetch: fetcher, signal }), STEP, {
    method: "POST",
    url: "https://login.example/token",
    headers: { "content-type": "text/plain" },
    body: "hello",
  });
  const [sent] = fetcher.sent;
  assertEquals(sent.method, "POST");
  assertEquals(sent.body, "hello");
  assertEquals(sent.headers.get("content-type"), "text/plain");
  assertEquals(sent.redirect, "manual");
  assertEquals(sent.signal, signal);
});

Deno.test("a network failure names the provider and step, with the secret masked", async () => {
  const { result } = get("https://login.example/token", () => {
    throw new TypeError("connection reset carrying secret-value-1234");
  });
  const error = await assertRejects(
    () => result,
    Error,
    "test: the token request failed: connection reset carrying [redacted]",
  );
  assertEquals(error.message.includes("secret-value-1234"), false);
  const thrown = get("https://login.example/token", () => {
    throw "a string, not an Error";
  });
  await assertRejects(() => thrown.result, Error, "a string, not an Error");
});

Deno.test("a redirect is refused rather than followed", async () => {
  const opaque = Object.defineProperty(new Response(null), "type", {
    value: "opaqueredirect",
  });
  for (
    const answer of [
      Response.redirect("http://evil.example/", 302),
      new Response("moved", { status: 301 }),
      opaque,
    ]
  ) {
    const { result } = get("https://login.example/token", () => answer);
    await assertRejects(
      () => result,
      Error,
      "a redirect, which is not followed",
    );
  }
});

Deno.test("an answer over the cap is refused", async () => {
  const { result } = get(
    "https://login.example/token",
    () => new Response("x".repeat(1024 * 1024 + 1)),
  );
  await assertRejects(() => result, Error, "the answer is larger than");
});

Deno.test("a refusal reports the useful part of the answer, secrets masked", async () => {
  const cases: Array<[Response, string]> = [
    [
      Response.json({
        error: "invalid_grant",
        error_description: "bad secret-value-1234",
      }, { status: 400 }),
      "HTTP 400: invalid_grant: bad [redacted]",
    ],
    [
      Response.json({ error: "invalid_client" }, { status: 401 }),
      "HTTP 401: invalid_client",
    ],
    [
      Response.json({ error: { code: 403, message: "denied" } }, {
        status: 403,
      }),
      "HTTP 403: denied",
    ],
    [
      Response.json({ error: { code: 403 } }, { status: 403 }),
      'HTTP 403: {"error":{"code":403}}',
    ],
    [Response.json(["x"], { status: 500 }), 'HTTP 500: ["x"]'],
    [
      new Response(
        "<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized</Message></Error></ErrorResponse>",
        { status: 403 },
      ),
      "HTTP 403: AccessDenied: Not authorized",
    ],
    [
      new Response("<Error><Message>only a message</Message></Error>", {
        status: 400,
      }),
      "HTTP 400: only a message",
    ],
    [
      new Response("plain   text\nfailure", { status: 502 }),
      "HTTP 502: plain text failure",
    ],
    [new Response("", { status: 503 }), "HTTP 503"],
  ];
  for (const [answer, message] of cases) {
    const { result } = get("https://login.example/token", () => answer);
    const error = await assertRejects(() => result, Error);
    assertStringIncludes(
      error.message,
      `test: the token request failed: ${message}`,
    );
  }
  const long = get(
    "https://login.example/token",
    () => new Response("y".repeat(1000), { status: 500 }),
  );
  const error = await assertRejects(() => long.result, Error);
  assertEquals(error.message.endsWith("…"), true);
});

Deno.test("a JSON answer is parsed; anything else fails without quoting the body", async () => {
  const fetcher = fakeFetch(() => Response.json({ access_token: "tok" }));
  const ctx = context({ fetch: fetcher });
  const request: AuthRequest = {
    method: "GET",
    url: "https://login.example/token",
    headers: {},
  };
  assertEquals(await authRequestJson(ctx, STEP, request), {
    access_token: "tok",
  });
  for (const body of ["secret-token-body", "[1]"]) {
    const error = await assertRejects(
      () =>
        authRequestJson(
          context({ fetch: fakeFetch(() => new Response(body)) }),
          STEP,
          request,
        ),
      Error,
      "the answer is not a JSON object",
    );
    assertEquals(error.message.includes(body), false);
  }
});

Deno.test("answer fields: strings required, lifetimes as numbers or numeric strings", () => {
  assertEquals(answerString({ a: "x" }, "a", STEP), "x");
  for (const answer of [{}, { a: "" }, { a: 1 }]) {
    let message = "";
    try {
      answerString(answer, "a", STEP);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    assertEquals(
      message,
      "test: the token request failed: the answer has no a",
    );
  }
  assertEquals(answerSeconds({ e: 60 }, "e", STEP), 60);
  assertEquals(answerSeconds({ e: "3599" }, "e", STEP), 3599);
  assertEquals(answerSeconds({}, "e", STEP), undefined);
  for (const value of ["soon", Infinity, true]) {
    let message = "";
    try {
      answerSeconds({ e: value }, "e", STEP);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    assertStringIncludes(message, "the answer's e is not a number of seconds");
  }
});

Deno.test("an unreadable file names the provider and path", async () => {
  await assertRejects(
    () => readAuthFile(context(), "test", "the token", "/no/such"),
    Error,
    "test: could not read the token at /no/such: no such file: /no/such",
  );
  await assertRejects(
    () =>
      readAuthFile(
        { ...context(), readTextFile: () => Promise.reject("denied") },
        "test",
        "the token",
        "/x",
      ),
    Error,
    "could not read the token at /x: denied",
  );
});
