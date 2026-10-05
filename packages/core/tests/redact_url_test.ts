// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the shared URL redactor: what it strips and masks, and that it
 * fails closed on input the URL parser rejects.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { HttpError, redactUrl, redactUrls } from "../mod.ts";

/** Assert none of `secrets` survives in `text`. */
function assertClean(text: string, ...secrets: string[]): void {
  for (const secret of secrets) {
    assertEquals(text.includes(secret), false, `${secret} leaked in ${text}`);
  }
}

Deno.test("userinfo is stripped and only credential parameters are masked", () => {
  assertEquals(
    redactUrl("https://ci:hunter2@host.example/x?token=abc&page=2"),
    "https://host.example/x?token=REDACTED&page=2",
  );
  assertEquals(redactUrl("https://host.example/x"), "https://host.example/x");
  assertEquals(
    redactUrl("postgres://app:pw@db.internal/prod"),
    "postgres://db.internal/prod",
  );
});

Deno.test("common credential names are recognised, and short ones only whole", () => {
  for (
    const name of [
      "pass",
      "Passwd",
      "jwt",
      "bearer",
      "otp",
      "code",
      "sid",
      "ticket",
      "X-Amz-Security-Token",
      "AWSAccessKeyId",
    ]
  ) {
    assertEquals(
      redactUrl(`https://h.example/?${name}=SECRET`),
      `https://h.example/?${name}=REDACTED`,
      name,
    );
  }
  // `code` matches whole, so a parameter that merely contains it is kept.
  assertEquals(
    redactUrl("https://h.example/?encode=utf8"),
    "https://h.example/?encode=utf8",
  );
});

Deno.test("a fragment's parameters are masked like the query's", () => {
  assertEquals(
    redactUrl("https://h.example/cb#access_token=SECRET&state=xyz"),
    "https://h.example/cb#access_token=REDACTED&state=xyz",
  );
  assertEquals(redactUrl("https://h.example/#top"), "https://h.example/#top");
});

Deno.test("an empty name and a semicolon-separated credential are masked", () => {
  assertClean(redactUrl("https://h.example/?=SECRET"), "SECRET");
  assertClean(redactUrl("https://h.example/?a=1;token=SECRET"), "SECRET");
});

Deno.test("a URL nested in a parameter value is redacted in turn", () => {
  const plain = redactUrl(
    "https://h.example/?next=https://u:S1@inner/?token=T1",
  );
  assertClean(plain, "S1", "T1");
  const encoded = redactUrl(
    "https://h.example/?redirect_uri=https%3A%2F%2Fa%3AS2%40c%2F%3Ftoken%3DT2",
  );
  assertClean(decodeURIComponent(encoded), "S2", "T2");
});

Deno.test("input the URL parser rejects is still scrubbed — the redactor fails closed", () => {
  for (
    const raw of [
      "https://u:SECRET@h.example:99999/x?token=TOK",
      "https://u:SECRET@ho st/x?token=TOK",
      "//u:SECRET@h.example/x?token=TOK",
    ]
  ) {
    assertClean(redactUrl(raw), "SECRET", "TOK");
  }
  assertEquals(redactUrl("not a url"), "not a url");
});

Deno.test("redactUrls redacts every URL in a message and leaves the rest", () => {
  const message = redactUrls(
    "fetch failed for https://u:SECRET@h.example/x?token=TOK (retry " +
      "redis://:PW@cache.internal/0 later)",
  );
  assertEquals(
    message,
    "fetch failed for https://h.example/x?token=REDACTED (retry " +
      "redis://cache.internal/0 later)",
  );
  assertEquals(redactUrls("no URL here"), "no URL here");
});

Deno.test("flags, malformed encoding and harmless parameters pass through", () => {
  assertEquals(
    redactUrl("https://h.example/?verbose&page=2"),
    "https://h.example/?verbose&page=2",
  );
  // Not valid percent-encoding: judged by its name as written.
  assertEquals(
    redactUrl("https://h.example/?token%zz=SECRET&q=%zz"),
    "https://h.example/?token%zz=REDACTED&q=%zz",
  );
  // The textual fallback keeps what is not a credential.
  assertEquals(
    redactUrl("https://u:SECRET@h.example:99999/x?page=2&token=T"),
    "https://h.example:99999/x?page=2&token=REDACTED",
  );
});

Deno.test("deeply nested URLs never throw, and the credential after them is masked", () => {
  const deep = "https://h.example/?n=".repeat(2000) + "x&token=SECRET";
  const redacted = redactUrl(deep);
  assertClean(redacted, "SECRET");
  // The error class that applies it must not crash either.
  const error = new HttpError(500, deep);
  assertClean(error.message, "SECRET");
});

Deno.test("long hostile input costs linear time, not quadratic", () => {
  for (
    const hostile of [
      "a".repeat(100_000),
      "https://h.example:99999/" + "?".repeat(100_000),
      "x" + "?a".repeat(50_000),
      "/".repeat(100_000),
    ]
  ) {
    const started = performance.now();
    redactUrls(hostile);
    redactUrl(hostile);
    const ms = performance.now() - started;
    assertEquals(ms < 1_000, true, `${hostile.slice(0, 12)}… took ${ms}ms`);
  }
});

Deno.test("redactUrls keeps the punctuation a sentence put after a URL", () => {
  assertEquals(
    redactUrls("see (https://h.example/x?token=a). ok"),
    "see (https://h.example/x?token=REDACTED). ok",
  );
  assertEquals(
    redactUrls('"https://h.example/x?sig=a", then'),
    '"https://h.example/x?sig=REDACTED", then',
  );
});

Deno.test("nested URLs are found through bad, double and missing encoding", () => {
  for (
    const raw of [
      "https://h.example/?next=https%3A%2F%2Fe%2F%3Ftoken%3DSECRET%FF",
      "https://h.example/?next=http%3A%2F%2Fu%3ASECRET%40e%2F%ZZ",
      "https://h.example/?next=http%253A%252F%252Fe%252F%253Ftoken%253DSECRET",
      "https://h.example/?next=//u:SECRET@e/",
      "https://h.example/x?https://u:SECRET@e/",
      "https://h.example/x#https://u:SECRET@e/",
    ]
  ) {
    // Plain ASCII survives percent-encoding, so any leak would show as is.
    assertClean(redactUrl(raw), "SECRET");
  }
});

Deno.test("a password holding a delimiter is stripped on the fallback path", () => {
  for (
    const raw of [
      "https://u:pa?ssSECRET@h.example/",
      "https://u:pa#ssSECRET@h.example/",
      "https://u:pa/ssSECRET@h.example/",
    ]
  ) {
    assertClean(redactUrl(raw), "SECRET");
  }
});

Deno.test("more credential names are recognised", () => {
  for (
    const name of [
      "access_code",
      "verification_code",
      "client_assertion",
      "SAMLResponse",
      "pw",
      "cred",
    ]
  ) {
    assertClean(redactUrl(`https://h.example/?${name}=SECRET`), "SECRET");
  }
});

Deno.test("a nested URL with nothing to redact keeps its spelling", () => {
  assertEquals(
    redactUrl("https://h.example/?next=https://e/?a=b+c"),
    "https://h.example/?next=https://e/?a=b+c",
  );
});

Deno.test("the textual scrub has no length past which it gives up", () => {
  assertClean(
    redactUrl("https://u:" + "a".repeat(600) + "SECRET@h.example:99999/"),
    "SECRET",
  );
  assertClean(
    redactUrl("https://h.example:99999/?" + "x".repeat(300) + "token=SECRET"),
    "SECRET",
  );
});

Deno.test("a nested credential is masked whatever form its URL takes", () => {
  for (
    const raw of [
      "https://h.example/?next=https%3A%2F%2Fu%3Apa%2520ssSECRET%40evil%2F",
      "https://h.example/?next=https%3Au%3ApSECRET%40evil%2F",
      "https://h.example/?next=https%3A%5C%5Cu%3ApSECRET%40evil%2F",
      "https://h.example/?next=https%3A%2Fu%3ApSECRET%40evil%2F",
      "https://h.example/?next=--https%3A%2F%2Fu%3ApSECRET%40evil",
    ]
  ) {
    assertClean(redactUrl(raw), "SECRET");
  }
  assertClean(redactUrl("https:\\\\u:pSECRET@h.example:99999/"), "SECRET");
});

Deno.test("redactUrls finds a URL whatever comes before it", () => {
  for (
    const message of [
      "log --https://u:pSECRET@h.example/x",
      "...https://u:pSECRET@h.example/x",
      "1https://u:pSECRET@h.example/x",
      "+https://u:pSECRET@h.example",
      "x".repeat(40) + "://u:pSECRET@h.example",
    ]
  ) {
    assertClean(redactUrls(message), "SECRET");
  }
});

Deno.test("trailing punctuation and slash runs cost linear time", () => {
  for (
    const hostile of [
      "https://h.example/" + ")".repeat(100_000) + "x",
      "https://h.example/" + ").".repeat(100_000) + "x",
      "/".repeat(200_000),
      "//".repeat(100_000) + "@",
    ]
  ) {
    const started = performance.now();
    redactUrls(hostile);
    redactUrl(hostile);
    const ms = performance.now() - started;
    assertEquals(ms < 1_000, true, `${hostile.slice(0, 20)}… took ${ms}ms`);
  }
});

Deno.test("edge tokens: no scheme letter, both separators, encoding past the limit", () => {
  // `://` with no scheme in front is not a URL: left as written.
  assertEquals(redactUrls("ratio 3://4 and ://x"), "ratio 3://4 and ://x");
  // The first separator wins when a token holds both kinds.
  assertClean(redactUrls("https://u:pSECRET@h.example/a:\\\\b"), "SECRET");
  assertClean(redactUrls("https:\\\\u:pSECRET@h.example/a://b"), "SECRET");
  // Still encoded after every layer the redactor decodes: masked, fail closed.
  let deep = "keep";
  for (let i = 0; i < 6; i++) deep = encodeURIComponent(`%${deep}`);
  assertEquals(
    redactUrl(`https://h.example/?next=${deep}`),
    "https://h.example/?next=REDACTED",
  );
});

Deno.test("input the parser rejects gets the same value checks as parsed input", () => {
  for (
    const raw of [
      "https://h.example:99999/?next=https%3A%2F%2Fu%3ApSECRET%40h",
      "https://h.example:99999/?next=x%26token%3DSECRET",
      "https://h.example:99999/?next=https://h/?token%3DSECRET",
      "https://h.example:99999/?a=1#x%26token%3DSECRET",
    ]
  ) {
    assertClean(redactUrl(raw), "SECRET");
  }
  assertClean(
    new HttpError(
      500,
      "https://u:p@h.example:99999/?next=https%3A%2F%2Fu%3ApSECRET%40h",
    )
      .message,
    "SECRET",
  );
});

Deno.test("redactUrls redacts every URL in a token, wherever it starts", () => {
  for (
    const message of [
      "mirrors=https://a.example/,https://u:pSECRET@b.example",
      "a,https://u:p@h,https://u2:pSECRET@h2",
      "x=https://h.example/?a=1,https://u:pSECRET@h2/?token=SECRET",
      "://https://u:pSECRET@h.example",
      "see -://https://u:pSECRET@h.example",
      "[://]https://u:pSECRET@h.example",
      "https:u:pSECRET@h.example/",
      "https:/u:pSECRET@h.example/",
      "HTTPS:u:p@h.example/?token=SECRET",
    ]
  ) {
    assertClean(redactUrls(message), "SECRET");
  }
});
