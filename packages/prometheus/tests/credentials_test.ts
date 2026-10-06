// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: authentication — each built-in credential source, the callback seeing
 * the exact outgoing request and the injected seams, ordering, conflicts, and
 * a failing source.
 */

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { Redactor } from "@zuke/core";
import {
  type PrometheusCredentialsContext,
  type PrometheusOutgoingRequest,
  PrometheusRequestError,
  PrometheusTasks,
} from "../mod.ts";
import { registerSecrets } from "../src/credentials.ts";
import { BASE, fakeFetch, vector } from "./_fetch.ts";

Deno.test("bearerToken, basicAuth and header each add their header", async () => {
  const fetcher = fakeFetch(() => vector());
  await PrometheusTasks.query((s) =>
    s.url(BASE).fetch(fetcher).query("q").bearerToken("test-token")
      .header("X-Scope-OrgID", "tenant-1")
  );
  await PrometheusTasks.query((s) =>
    s.url(BASE).fetch(fetcher).query("q").basicAuth("zuke", "p€ss")
  );
  assertEquals(
    fetcher.sent[0].headers.get("authorization"),
    "Bearer test-token",
  );
  assertEquals(fetcher.sent[0].headers.get("x-scope-orgid"), "tenant-1");
  // UTF-8, per RFC 7617, rather than btoa's Latin-1-only input.
  const utf8 = String.fromCharCode(
    ...new TextEncoder().encode("zuke:p€ss"),
  );
  assertEquals(
    fetcher.sent[1].headers.get("authorization"),
    `Basic ${btoa(utf8)}`,
  );
});

Deno.test("an empty token and a username with a colon are refused", async () => {
  await assertRejects(
    () => PrometheusTasks.query((s) => s.bearerToken("")),
    Error,
    "empty token",
  );
  await assertRejects(
    () => PrometheusTasks.query((s) => s.basicAuth("a:b", "c")),
    Error,
    "containing ':'",
  );
});

Deno.test("a credentials callback sees the exact request and the injected seams", async () => {
  const seen: Array<
    [PrometheusOutgoingRequest, PrometheusCredentialsContext]
  > = [];
  const fetcher = fakeFetch(() => vector());
  const files: Record<string, string> = { "/run/secrets/prom": "file-token" };
  await PrometheusTasks.query((s) =>
    s.url(`${BASE}/prefix?tenant=a`).fetch(fetcher).query("up{a='b c'}")
      .time(5)
      .header("x-first", "first")
      .readEnv((name) => name === "PROM_REGION" ? "eu-west-1" : undefined)
      .readTextFile((path) => Promise.resolve(files[path] ?? ""))
      .now(() => 1_700_000_000_000)
      .credentials(async (request, context) => {
        seen.push([request, context]);
        const token = await context.readTextFile("/run/secrets/prom");
        return {
          authorization: `Bearer ${token}`,
          "x-region": context.readEnv("PROM_REGION") ?? "",
          "x-time": String(context.now()),
        };
      })
  );
  const [[request, context]] = seen;
  const [sent] = fetcher.sent;
  assertEquals(request.method, "POST");
  assertEquals(request.url, sent.url.href);
  assertEquals(request.url, `${BASE}/prefix/api/v1/query?tenant=a`);
  assertEquals(new TextDecoder().decode(request.body), sent.body);
  assertEquals(sent.body, "query=up%7Ba%3D%27b+c%27%7D&time=5");
  assertEquals(request.headers, {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
    "x-first": "first",
  });
  assertEquals(context.fetch, fetcher);
  assertEquals(context.signal.aborted, false);
  assertEquals(sent.headers.get("authorization"), "Bearer file-token");
  assertEquals(sent.headers.get("x-region"), "eu-west-1");
  assertEquals(sent.headers.get("x-time"), "1700000000000");
});

Deno.test("the default seams read the real file system, environment and clock", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/token`;
    await Deno.writeTextFile(path, "file-token");
    const fetcher = fakeFetch(() => vector());
    const before = Date.now();
    let now = 0;
    await PrometheusTasks.query((s) =>
      s.url(BASE).fetch(fetcher).query("q")
        .credentials(async (_request, context) => {
          now = context.now();
          return {
            authorization: `Bearer ${await context.readTextFile(path)}`,
            "x-env": String(context.readEnv("ZUKE_PROMETHEUS_TEST_UNSET")),
          };
        })
    );
    assertEquals(
      fetcher.sent[0].headers.get("authorization"),
      "Bearer file-token",
    );
    assertEquals(fetcher.sent[0].headers.get("x-env"), "undefined");
    assertEquals(now >= before, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a GET request hands the callback an empty body and the query in the URL", async () => {
  let seen: PrometheusOutgoingRequest | undefined;
  await PrometheusTasks.labelValues((s) =>
    s.url(BASE).fetch(
      fakeFetch(() => Response.json({ status: "success", data: [] })),
    )
      .labelName("job").match("up")
      .credentials((request) => {
        seen = request;
        return {};
      })
  );
  assertEquals(seen?.method, "GET");
  assertEquals(seen?.body.length, 0);
  assertEquals(
    seen?.url,
    `${BASE}/api/v1/label/job/values?match%5B%5D=up`,
  );
  assertEquals(seen?.headers, { accept: "application/json" });
});

Deno.test("a source cannot change the body that is sent", async () => {
  const fetcher = fakeFetch(() => vector());
  await PrometheusTasks.query((s) =>
    s.url(BASE).fetch(fetcher).query("q").credentials((request) => {
      request.body.fill(0);
      return {};
    })
  );
  assertEquals(fetcher.sent[0].body, "query=q");
});

Deno.test("two sources setting the same header fail the call, naming the header", async () => {
  const fetcher = fakeFetch(() => vector());
  await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url(BASE).fetch(fetcher).query("q").bearerToken("test-token-one")
          .header("Authorization", "Bearer test-token-two")
      ),
    PrometheusRequestError,
    "two credential sources set the authorization header",
  );
  await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url(BASE).fetch(fetcher).query("q")
          .credentials(() => ({ "Content-Type": "text/plain" }))
      ),
    PrometheusRequestError,
    "content-type header",
  );
  assertEquals(fetcher.sent.length, 0);
});

Deno.test("a failing source fails the call, with earlier sources' secrets masked", async () => {
  const fetcher = fakeFetch(() => vector());
  const error = await assertRejects(
    () =>
      PrometheusTasks.query((s) =>
        s.url(BASE).fetch(fetcher).query("q").bearerToken("test-token-one")
          .credentials(() => {
            throw new Error("token exchange failed for test-token-one");
          })
      ),
    PrometheusRequestError,
    "token exchange failed for [redacted]",
  );
  assertEquals(error.message.includes("test-token-one"), false);
  assertEquals(fetcher.sent.length, 0);
});

Deno.test("a header named __proto__ stays a header", async () => {
  let seen: PrometheusOutgoingRequest | undefined;
  await PrometheusTasks.query((s) =>
    s.url(BASE).fetch(fakeFetch(() => vector())).query("q")
      .credentials(() => JSON.parse('{"__proto__": "x"}'))
      .credentials((request) => {
        seen = request;
        return {};
      })
  );
  assertEquals(Object.hasOwn(seen?.headers ?? {}, "__proto__"), true);
});

Deno.test("short values are not masked; a scheme's credential is masked alone", () => {
  const redactor = new Redactor();
  registerSecrets(redactor, "1");
  registerSecrets(redactor, "Bearer short");
  registerSecrets(redactor, "Bearer test-token");
  assertEquals(
    redactor.redact("HTTP 401: 1 short test-token"),
    "HTTP 401: 1 short [redacted]",
  );
});
