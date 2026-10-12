// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  SignPathApiError,
  SignPathRequestError,
  type SignPathStatusSettings,
  SignPathTasks,
} from "../mod.ts";
import {
  connected,
  fakeFetch,
  REQUEST,
  routes,
  status,
  STATUS_URL,
  TOKEN,
} from "./_fetch.ts";

/** Read {@link REQUEST}'s status through `net`, recording the sleeps. */
function read(net: typeof fetch, sleeps: number[] = []) {
  return SignPathTasks.status((s) =>
    connected<SignPathStatusSettings>(net, { sleeps })(s).signingRequestId(
      REQUEST,
    )
  );
}

Deno.test("transport: a transient status is retried with a doubling delay", async () => {
  for (const code of [429, 502, 503, 504]) {
    const net = routes({
      [`GET ${STATUS_URL}`]: [
        () => new Response("busy", { status: code }),
        () => new Response("busy", { status: code }),
        status("InProgress"),
      ],
    });
    const sleeps: number[] = [];
    const result = await read(net, sleeps);
    assertEquals(result.status, "InProgress");
    assertEquals(sleeps, [1000, 2000]);
  }
});

Deno.test("transport: the retries run out into the refusal", async () => {
  const net = fakeFetch(() => new Response("still busy", { status: 503 }));
  const sleeps: number[] = [];
  const error = await assertRejects(
    () =>
      SignPathTasks.status((s) =>
        connected<SignPathStatusSettings>(net, { sleeps })(s).retries(5)
          .signingRequestId(REQUEST)
      ),
    SignPathApiError,
    "HTTP 503: still busy",
  );
  assertEquals(net.sent.length, 6);
  assertEquals(sleeps, [1000, 2000, 4000, 8000, 16000]);
  assertEquals(error instanceof SignPathApiError && error.detail, "still busy");
  const capped = fakeFetch(() => new Response("", { status: 502 }));
  const long: number[] = [];
  await assertRejects(
    () =>
      SignPathTasks.status((s) =>
        connected<SignPathStatusSettings>(capped, { sleeps: long })(s)
          .retries(7).signingRequestId(REQUEST)
      ),
    SignPathApiError,
  );
  assertEquals(long.at(-1), 30000);
});

Deno.test("transport: a client error is not retried", async () => {
  const net = fakeFetch(() => new Response("", { status: 404 }));
  const error = await assertRejects(() => read(net), SignPathApiError);
  assertEquals(net.sent.length, 1);
  assertEquals(error instanceof SignPathApiError && error.detail, undefined);
});

Deno.test("transport: a network error is retried for a read, then reported scrubbed", async () => {
  let calls = 0;
  const flaky = fakeFetch(() => {
    calls++;
    if (calls === 1) throw new TypeError("connection reset");
    return status("InProgress")();
  });
  assertEquals((await read(flaky)).status, "InProgress");
  const down = fakeFetch(() => {
    throw new TypeError(`dns failure for Bearer ${TOKEN}`);
  });
  const error = await assertRejects(
    () => read(down),
    SignPathRequestError,
    "dns failure",
  );
  assertEquals(error.message.includes(TOKEN), false);
  assertEquals(down.sent.length, 4);
  const odd = fakeFetch(() => {
    throw "a string";
  });
  await assertRejects(
    () =>
      SignPathTasks.status((s) =>
        connected<SignPathStatusSettings>(odd)(s).retries(0).signingRequestId(
          REQUEST,
        )
      ),
    SignPathRequestError,
    "a string",
  );
});

Deno.test("transport: a call that times out says so", async () => {
  const hang = fakeFetch((request) =>
    new Promise((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => reject(new Error("x")));
    })
  );
  await assertRejects(
    () =>
      SignPathTasks.status((s) =>
        connected<SignPathStatusSettings>(hang)(s).retries(0)
          .requestTimeout(5).signingRequestId(REQUEST)
      ),
    SignPathRequestError,
    "timed out after 5 ms",
  );
});

Deno.test("transport: an answer whose body stalls past the timeout says so", async () => {
  const stall = fakeFetch((request) =>
    new Response(
      new ReadableStream({
        start(controller) {
          request.signal?.addEventListener(
            "abort",
            () => controller.error(new Error("aborted")),
          );
        },
      }),
    )
  );
  await assertRejects(
    () =>
      SignPathTasks.status((s) =>
        connected<SignPathStatusSettings>(stall)(s).requestTimeout("10ms")
          .signingRequestId(REQUEST)
      ),
    SignPathRequestError,
    "timed out after 10 ms",
  );
});

Deno.test("transport: an API redirect is refused, never followed", async () => {
  const net = fakeFetch(() =>
    new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/steal" },
    })
  );
  await assertRejects(
    () => read(net),
    SignPathRequestError,
    "redirect (HTTP 302)",
  );
  assertEquals(net.sent.length, 1);
});

Deno.test("transport: an oversized answer is refused", async () => {
  const net = fakeFetch(() => new Response("x".repeat(1024 * 1024 + 1)));
  await assertRejects(() => read(net), SignPathRequestError, "larger than");
});

Deno.test("transport: a refusal's detail comes from the documented fields, capped", async () => {
  const cases: Array<[unknown, string | undefined]> = [
    [{ detail: "the detail" }, "the detail"],
    [{ title: "the title" }, "the title"],
    [{ message: "the message" }, "the message"],
    [{ other: 1 }, undefined],
    [{ error: "" }, undefined],
  ];
  for (const [body, detail] of cases) {
    const net = fakeFetch(() => Response.json(body, { status: 400 }));
    const error = await assertRejects(() => read(net), SignPathApiError);
    assertEquals(error instanceof SignPathApiError && error.detail, detail);
  }
  const long = fakeFetch(() => new Response("y".repeat(2000), { status: 500 }));
  const error = await assertRejects(() => read(long), SignPathApiError);
  assertStringIncludes(error.message, "…");
  assertEquals(error.message.length < 700, true);
});
