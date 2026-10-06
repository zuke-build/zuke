// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: the transport every endpoint shares — the URL guard, base paths, error
 * envelopes, non-JSON answers, timeouts, cancellation, the size cap, and that
 * no error ever carries a credential.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { InsecureBackendUrlError } from "@zuke/core";
import {
  PrometheusApiError,
  type PrometheusQuerySettings,
  PrometheusRequestError,
  PrometheusTasks,
} from "../mod.ts";
import { BASE, fakeFetch, vector } from "./_fetch.ts";

/** An env reader over a record. */
const env = (vars: Record<string, string>) => (name: string) => vars[name];

Deno.test("a plaintext non-loopback URL is refused before anything is sent", async () => {
  const fetcher = fakeFetch(() => vector());
  await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url("http://prom.example").readEnv(env({})).fetch(fetcher).query("q")
      ),
    InsecureBackendUrlError,
    "the Prometheus URL must use https",
  );
  assertEquals(fetcher.sent.length, 0);
});

Deno.test("loopback plaintext is allowed, and the opt-out allows any plaintext", async () => {
  const fetcher = fakeFetch(() => vector());
  await PrometheusTasks.query((s) =>
    s.url("http://localhost:9090").readEnv(env({})).fetch(fetcher).query("q")
  );
  await PrometheusTasks.query((s) =>
    s.url("http://prom.internal:9090")
      .readEnv(env({ ZUKE_ALLOW_INSECURE_URL: "1" })).fetch(fetcher).query("q")
  );
  assertEquals(fetcher.sent.map((r) => r.url.origin), [
    "http://localhost:9090",
    "http://prom.internal:9090",
  ]);
});

Deno.test("a URL that is missing, malformed or not http(s) is refused", async () => {
  const fetcher = fakeFetch(() => vector());
  const cases: Array<[string | undefined, string]> = [
    [undefined, "call s.url(...)"],
    ["not a url", "is not a valid URL"],
    ["file:///etc/passwd", "must be http(s)"],
  ];
  for (const [url, message] of cases) {
    await assertRejects(
      () =>
        PrometheusTasks.query((s) => {
          s.fetch(fetcher).readEnv(env({ ZUKE_ALLOW_INSECURE_URL: "1" }))
            .query("q");
          return url === undefined ? s : s.url(url);
        }),
      Error,
      message,
    );
  }
  assertEquals(fetcher.sent.length, 0);
});

Deno.test("the base URL's path and query are kept and its fragment dropped", async () => {
  const fetcher = fakeFetch(() => vector());
  await PrometheusTasks.query((s) =>
    s.url("https://proxy.example/prom/?org=7#frag").fetch(fetcher)
      .httpMethod("GET").query("up")
  );
  const [sent] = fetcher.sent;
  assertEquals(sent.url.pathname, "/prom/api/v1/query");
  assertEquals([...sent.url.searchParams], [["org", "7"], ["query", "up"]]);
  assertEquals(sent.url.hash, "");
});

Deno.test("an error envelope becomes a PrometheusApiError with status, errorType and message", async () => {
  const error = await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url(BASE).query("rate(x[5m]").fetch(fakeFetch(() =>
          Response.json({
            status: "error",
            errorType: "bad_data",
            error: "1:11: parse error: unclosed left parenthesis",
          }, { status: 400 })
        ))
      ),
    PrometheusApiError,
  );
  if (!(error instanceof PrometheusApiError)) throw error;
  assertEquals(error.status, 400);
  assertEquals(error.errorType, "bad_data");
  assertEquals(error.method, "POST");
  assertEquals(error.path, "/api/v1/query");
  assertEquals(error.detail, "1:11: parse error: unclosed left parenthesis");
  assertEquals(
    error.message,
    "POST /api/v1/query failed: HTTP 400 (bad_data): 1:11: parse error: " +
      "unclosed left parenthesis",
  );
});

Deno.test("an error status on a 2xx and an HTTP error without an envelope are both refusals", async () => {
  const cases: Array<[Response, number, string | undefined]> = [
    [Response.json({ status: "error", error: "x" }), 200, "x"],
    [Response.json({}, { status: 500 }), 500, undefined],
    [
      new Response("<html>bad   gateway</html>", { status: 502 }),
      502,
      "<html>bad gateway</html>",
    ],
    [new Response("", { status: 504 }), 504, undefined],
  ];
  for (const [response, status, detail] of cases) {
    const error = await assertRejects(
      () =>
        PrometheusTasks.query((s) =>
          s.url(BASE).query("q").fetch(fakeFetch(() => response))
        ),
      PrometheusApiError,
    );
    if (!(error instanceof PrometheusApiError)) throw error;
    assertEquals([error.status, error.detail, error.errorType], [
      status,
      detail,
      undefined,
    ]);
  }
});

Deno.test("a 2xx that is not a Prometheus envelope is a request error, not a refusal", async () => {
  const cases: Array<[Response, string]> = [
    [
      new Response("<html>login</html>"),
      "not a Prometheus envelope: <html>login</html>",
    ],
    [new Response(""), "not a Prometheus envelope"],
    [Response.json([1, 2]), "not a Prometheus envelope"],
    [Response.json({ data: {} }), 'no "status" of "success" or "error"'],
  ];
  for (const [response, message] of cases) {
    const error = await assertRejects(
      () =>
        PrometheusTasks.query((s) =>
          s.url(BASE).query("q").fetch(fakeFetch(() => response))
        ),
      PrometheusRequestError,
      message,
    );
    if (!(error instanceof PrometheusRequestError)) throw error;
    assertEquals(error.status, 200);
  }
});

Deno.test("a long server message is capped", async () => {
  const error = await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url(BASE).query("q").fetch(
          fakeFetch(() =>
            Response.json({ status: "error", error: "e".repeat(2000) }, {
              status: 422,
            })
          ),
        )
      ),
    PrometheusApiError,
  );
  if (!(error instanceof PrometheusApiError)) throw error;
  assertEquals(error.detail?.length, 501);
  assertEquals(error.detail?.endsWith("…"), true);
});

Deno.test("an answer over maxResponseBytes fails instead of being buffered", async () => {
  await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url(BASE).query("q").maxResponseBytes(16)
          .fetch(fakeFetch(() => vector([{}, "1"])))
      ),
    PrometheusRequestError,
    "the answer is larger than 16 bytes",
  );
  for (const bad of [0, -1, 1.5]) {
    await assertRejects(
      () => PrometheusTasks.query((s) => s.maxResponseBytes(bad)),
      Error,
      "must be a positive whole number",
    );
  }
});

Deno.test("a request that outlives requestTimeout fails as a timeout", async () => {
  const fetcher = fakeFetch((request) =>
    new Promise((_resolve, reject) => {
      request.signal?.addEventListener("abort", () =>
        reject(request.signal?.reason));
    })
  );
  await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url(BASE).query("q").requestTimeout(5).fetch(fetcher)
      ),
    PrometheusRequestError,
    "POST /api/v1/query failed: timed out after 5 ms",
  );
});

Deno.test("the caller's own cancellation is rethrown as itself, not as a failure", async () => {
  const stop = new AbortController();
  const reason = new Error("run cancelled");
  const fetcher = fakeFetch(() => {
    stop.abort(reason);
    return Promise.reject(new DOMException("aborted", "AbortError"));
  });
  const error = await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url(BASE).query("q").signal(stop.signal).fetch(fetcher)
      ),
    Error,
  );
  assertEquals(error, reason);
});

Deno.test("a signal that never fires leaves the call alone", async () => {
  const fetcher = fakeFetch(() => vector([{}, "1"]));
  const response = await PrometheusTasks.query((s) =>
    s.url(BASE).query("q").signal(new AbortController().signal).fetch(fetcher)
  );
  assertEquals(PrometheusTasks.value(response), 1);
  assertEquals(fetcher.sent[0].signal?.aborted, false);
});

Deno.test("credentials never reach an error: network failure, refusal and echo", async () => {
  const token = "test-token-value";
  const password = "test-password";
  const basic = btoa(`user:${password}`);
  const echo = (url: URL) =>
    `error sending request for url (${url.href}) with Bearer ${token} ` +
    `and Basic ${basic} key=${password}`;
  const fetchers = () => [
    fakeFetch((r) => Promise.reject(new TypeError(echo(r.url)))),
    fakeFetch((r) => new Response(echo(r.url), { status: 401 })),
    fakeFetch((r) =>
      Response.json({
        status: "error",
        errorType: echo(r.url),
        error: echo(r.url),
      }, { status: 403 })
    ),
    fakeFetch((r) => new Response(echo(r.url))),
  ];
  const configs: Array<
    [(s: PrometheusQuerySettings) => PrometheusQuerySettings, string[]]
  > = [
    [(s) => s.bearerToken(token).header("x-api-key", password), [
      token,
      password,
    ]],
    [(s) => s.basicAuth("user", password), [basic]],
  ];
  for (const [configure, secrets] of configs) {
    for (const fetcher of fetchers()) {
      const error = await assertRejects(
        () =>
          PrometheusTasks.query((s) =>
            configure(s.url(`${BASE}/?api_key=test-query-key`)).fetch(fetcher)
              .query("q")
          ),
        Error,
      );
      const text = `${error.message} ${JSON.stringify(error)}`;
      for (const secret of [...secrets, "test-query-key"]) {
        assertEquals(text.includes(secret), false, `${secret} in ${text}`);
      }
      assertStringIncludes(text, "[redacted]");
    }
  }
});

Deno.test("userinfo in the URL is sent as basic auth, never in the URL", async () => {
  const fetcher = fakeFetch((r) => Promise.reject(new TypeError(r.url.href)));
  const error = await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url("https://admin:hunter2%21@prom.example/").fetch(fetcher)
          .query("q")
      ),
    PrometheusRequestError,
    "https://prom.example/api/v1/query",
  );
  const [sent] = fetcher.sent;
  assertEquals(sent.url.username, "");
  assertEquals(sent.url.password, "");
  assertEquals(
    sent.headers.get("authorization"),
    `Basic ${btoa("admin:hunter2!")}`,
  );
  assertEquals(error.message.includes("hunter2"), false);
});

// Regressions from the adversarial pass.

Deno.test("malformed percent-encoding in the userinfo is named, without the value", async () => {
  const error = await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url("https://admin:pass%ZZ-x@prom.example").query("q")
      ),
    Error,
    "not valid percent-encoding",
  );
  assertEquals(error.message.includes("pass"), true); // "pass them with …"
  assertEquals(error.message.includes("%ZZ-x"), false);
});

Deno.test("a base URL parameter that collides with the call's own is refused", async () => {
  const fetcher = fakeFetch(() => vector());
  for (const method of ["GET", "POST"] as const) {
    await assertRejects(
      () =>
        PrometheusTasks.query((s) =>
          s.url(`${BASE}/?query=up`).fetch(fetcher).httpMethod(method)
            .query("sum(errors)")
        ),
      Error,
      'already carries a "query" parameter',
    );
  }
  assertEquals(fetcher.sent.length, 0);
});

Deno.test("a redirect is not followed, and says so", async () => {
  const opaque = Object.defineProperty(new Response(null), "type", {
    value: "opaqueredirect",
  });
  const answers = [
    Response.redirect("http://prom.example/login", 302),
    new Response("moved", {
      status: 301,
      headers: { location: "http://prom.example/" },
    }),
    opaque,
  ];
  for (const answer of answers) {
    const error = await assertRejects(
      () =>
        PrometheusTasks.query((s) =>
          s.url(BASE).query("q").fetch(fakeFetch(() => answer))
        ),
      PrometheusApiError,
      "redirect, which is not followed",
    );
    if (!(error instanceof PrometheusApiError)) throw error;
    assertEquals(error.status, answer.status);
  }
});

Deno.test("a header value with a line break is refused without quoting it", async () => {
  const fetcher = fakeFetch(() => vector());
  const error = await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url(BASE).fetch(fetcher).query("q")
          .bearerToken("test-token-from-file\n")
      ),
    PrometheusRequestError,
    "authorization header's value contains a line break",
  );
  assertEquals(error.message.includes("test-token-from-file"), false);
  assertEquals(fetcher.sent.length, 0);
});
