// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Unit tests for `httpProbe(...)`, answered by a fake `fetch`. */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { httpProbe } from "../mod.ts";
import { analysisContext, fakeFetch } from "./_context.ts";

Deno.test("a healthy URL passes every sample", async () => {
  const fetcher = fakeFetch(() => new Response("ok"));
  await httpProbe((h) =>
    h.url("https://api.example/healthz").samples(3).interval(0)
      .header("X-Probe", "1").fetch(fetcher)
  ).validate(analysisContext());
  assertEquals(fetcher.urls.length, 3);
  assertEquals(fetcher.headers[0].get("X-Probe"), "1");
});

Deno.test("too many failures fail the probe, grouped by reason and redacted", async () => {
  const fetcher = fakeFetch((_url, call) => {
    if (call === 1) return new Response("", { status: 503 });
    if (call === 2) return new Response("", { status: 503 });
    if (call === 3) return Promise.reject(new TypeError("connection refused"));
    return new Response("ok");
  });
  const error = await assertRejects(
    async () =>
      await httpProbe((h) =>
        h.url("https://s3cr3t.example/healthz").samples(4).interval(0)
          .maxFailures(1).fetch(fetcher)
      ).validate(analysisContext()),
    Error,
  );
  assertStringIncludes(
    String(error),
    "3 of 4 requests to https://[redacted].example/healthz failed (at most 1 " +
      "allowed): HTTP 503 ×2, connection refused",
  );
});

Deno.test("expected statuses replace the 2xx default", async () => {
  await httpProbe((h) =>
    h.url("https://api.example").samples(1).expectStatus(204, 301)
      .fetch(fakeFetch(() => new Response(null, { status: 301 })))
  ).validate(analysisContext());
  await assertRejects(
    async () =>
      await httpProbe((h) =>
        h.url("https://api.example").samples(1).expectStatus(204)
          .fetch(fakeFetch(() => new Response("ok")))
      ).validate(analysisContext()),
    Error,
    "HTTP 200",
  );
});

Deno.test("a request that times out counts as a failure", async () => {
  const hang = fakeFetch((_url) =>
    Promise.reject(new DOMException("timed out", "TimeoutError"))
  );
  await assertRejects(
    async () =>
      await httpProbe((h) =>
        h.url("https://api.example").samples(1).timeout("1s").fetch(hang)
      )
        .validate(analysisContext()),
    Error,
    "timeout",
  );
});

Deno.test("the run's cancellation is not reported as the candidate's failure", async () => {
  const stop = new AbortController();
  const fetcher = fakeFetch(() => {
    stop.abort(new Error("run cancelled"));
    return Promise.reject(new DOMException("aborted", "AbortError"));
  });
  await assertRejects(
    async () =>
      await httpProbe((h) =>
        h.url("https://api.example").samples(2).fetch(fetcher)
      )
        .validate(analysisContext(stop.signal)),
    Error,
    "run cancelled",
  );
});

Deno.test("a probe with no URL or no samples is refused", async () => {
  await assertRejects(
    async () => await httpProbe((h) => h).validate(analysisContext()),
    Error,
    "has no URL",
  );
  await assertRejects(
    async () =>
      await httpProbe((h) => h.url("u").samples(0)).validate(analysisContext()),
    Error,
    "at least one sample",
  );
});

Deno.test("credentials in the probe URL never reach the failure message", async () => {
  const error = await assertRejects(
    async () =>
      await httpProbe((h) =>
        h.url("https://admin:hunter2@api.example/healthz?token=abc&region=eu")
          .samples(1)
          .fetch(fakeFetch(() => new Response("", { status: 500 })))
      ).validate(analysisContext()),
    Error,
  );
  // The shared core redactor masks the credential and keeps the rest of the
  // query, so the message still says which endpoint failed.
  assertStringIncludes(
    String(error),
    "https://api.example/healthz?token=REDACTED&region=eu failed",
  );
  for (const secret of ["hunter2", "admin", "token=abc"]) {
    assertEquals(String(error).includes(secret), false, secret);
  }
});

Deno.test("a maxFailures that could never mean anything is refused", async () => {
  for (const bad of [Number.NaN, -1, 1.5]) {
    await assertRejects(
      async () =>
        await httpProbe((h) =>
          h.url("https://api.example").maxFailures(bad)
            .fetch(fakeFetch(() => new Response("ok")))
        ).validate(analysisContext()),
      Error,
      "whole, non-negative maxFailures",
    );
  }
});

Deno.test("an interval or timeout past the longest timer is refused", async () => {
  await assertRejects(
    async () =>
      await httpProbe((h) => h.url("https://api.example").interval("30d"))
        .validate(analysisContext()),
    Error,
    "longest timer",
  );
});

Deno.test("the run's redactor sees a secret before the URL is re-spelled", async () => {
  const error = await assertRejects(
    async () =>
      await httpProbe((h) =>
        h.url("https://Hooks.example/s3cr3t{x}").samples(1)
          .fetch(fakeFetch(() => new Response("", { status: 500 })))
      ).validate(analysisContext()),
    Error,
  );
  // Core's URL redactor re-serialises the URL (a lowercased host, an encoded
  // path), so it must run after the run's redactor has masked the secret.
  assertEquals(String(error).includes("s3cr3t"), false);
  assertStringIncludes(
    String(error),
    "https://hooks.example/[redacted]%7Bx%7D",
  );
});

Deno.test("a password with brackets in it does not slip past the cleaning", async () => {
  const error = await assertRejects(
    async () =>
      await httpProbe((h) =>
        h.url("https://u:p(a)ss@api.example/x?api_key=1").samples(1)
          .fetch(fakeFetch(() => new Response("", { status: 500 })))
      ).validate(analysisContext()),
    Error,
  );
  for (const secret of ["p(a)ss", "(a)ss", "api_key=1"]) {
    assertEquals(String(error).includes(secret), false, secret);
  }
  assertStringIncludes(
    String(error),
    "https://api.example/x?api_key=REDACTED failed",
  );
});
