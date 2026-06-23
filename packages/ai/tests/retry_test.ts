import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { AiReviewError } from "../mod.ts";
import { retryingFetch } from "../src/retry.ts";

/** A recorded sleep, so tests can assert backoff timing without waiting. */
interface Recorded {
  sleeps: number[];
  sleep: (ms: number) => Promise<void>;
}

/** A sleep seam that records each delay and returns immediately. */
function recordSleep(): Recorded {
  const sleeps: number[] = [];
  return { sleeps, sleep: (ms) => (sleeps.push(ms), Promise.resolve()) };
}

/**
 * A fake `fetch` that returns the next pre-canned response on each call.
 * `responses` may contain `Response` values or thrown errors (use `Error` to
 * simulate a network failure).
 */
function scriptedFetch(
  ...responses: Array<Response | Error>
): { fetch: typeof fetch; calls: number } {
  let i = 0;
  const state = { calls: 0 };
  const impl = ((_input: string | URL | Request, _init?: RequestInit) => {
    state.calls++;
    const next = responses[i++];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }) as typeof fetch;
  return {
    get calls() {
      return state.calls;
    },
    fetch: impl,
  };
}

Deno.test("a single transient 503 is retried, then the 200 succeeds", async () => {
  const { sleeps, sleep } = recordSleep();
  const f = scriptedFetch(
    new Response("overloaded", { status: 503 }),
    new Response("ok", { status: 200 }),
  );
  const response = await retryingFetch(
    f.fetch,
    "https://api.example/x",
    { method: "POST" },
    { baseDelayMs: 10, sleep },
  );
  assertEquals(response.status, 200);
  assertEquals(f.calls, 2);
  assertEquals(sleeps, [10]); // exactly one backoff between the two attempts
});

Deno.test("all attempts return retryable failures: the last response surfaces", async () => {
  const { sleeps, sleep } = recordSleep();
  const f = scriptedFetch(
    new Response("", { status: 503 }),
    new Response("", { status: 503 }),
    new Response("", { status: 503 }),
  );
  const response = await retryingFetch(
    f.fetch,
    "https://api.example/x",
    { method: "POST" },
    { attempts: 3, baseDelayMs: 5, sleep },
  );
  assertEquals(response.status, 503); // caller now decides how to surface it
  assertEquals(f.calls, 3);
  assertEquals(sleeps, [5, 10]); // exponential backoff between attempts
});

Deno.test("non-retryable statuses (e.g. 401) come straight back without a sleep", async () => {
  const { sleeps, sleep } = recordSleep();
  const f = scriptedFetch(new Response("nope", { status: 401 }));
  const response = await retryingFetch(
    f.fetch,
    "https://api.example/x",
    { method: "POST" },
    { sleep },
  );
  assertEquals(response.status, 401);
  assertEquals(f.calls, 1);
  assertEquals(sleeps.length, 0);
});

Deno.test("a Retry-After header (seconds) overrides the exponential backoff", async () => {
  const { sleeps, sleep } = recordSleep();
  const f = scriptedFetch(
    new Response("", { status: 429, headers: { "retry-after": "7" } }),
    new Response("ok", { status: 200 }),
  );
  await retryingFetch(
    f.fetch,
    "https://api.example/x",
    { method: "POST" },
    { baseDelayMs: 1000, sleep },
  );
  assertEquals(sleeps, [7000]); // honoured the header, not the 1000ms base
});

Deno.test("a thrown fetch (network error) is retried, then surfaces an AiReviewError", async () => {
  const { sleeps, sleep } = recordSleep();
  const f = scriptedFetch(
    new TypeError("connection reset"),
    new TypeError("connection reset"),
  );
  await assertRejects(
    () =>
      retryingFetch(f.fetch, "https://api.example/x", { method: "POST" }, {
        attempts: 2,
        baseDelayMs: 5,
        sleep,
      }),
    AiReviewError,
    "network error after 2 attempt(s): connection reset",
  );
  assertEquals(f.calls, 2);
  assertEquals(sleeps, [5]); // one backoff between the two attempts
});

Deno.test("a thrown fetch followed by a success returns the success", async () => {
  const { sleep } = recordSleep();
  const f = scriptedFetch(
    new TypeError("temporary DNS failure"),
    new Response("ok", { status: 200 }),
  );
  const response = await retryingFetch(
    f.fetch,
    "https://api.example/x",
    { method: "POST" },
    { baseDelayMs: 5, sleep },
  );
  assertEquals(response.status, 200);
});
