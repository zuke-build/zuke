import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { HttpError } from "@zuke/core";
import { SecretManagerTasks } from "../src/secret_manager.ts";

/** A `fetch` double that records calls and answers from a handler. */
function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response,
): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { fetch, calls };
}

/** Base64-encode a UTF-8 string, matching the payload wire format. */
function b64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

Deno.test("access decodes the latest payload of a secret", async () => {
  const { fetch, calls } = fakeFetch(() =>
    new Response(JSON.stringify({ payload: { data: b64("s3cr3t-ü") } }), {
      status: 200,
    })
  );
  const value = await SecretManagerTasks.access("db-password", {
    project: "p",
    token: "t0",
    fetch,
  });
  assertEquals(value, "s3cr3t-ü"); // round-trips UTF-8
  assertStringIncludes(
    calls[0].url,
    "/projects/p/secrets/db-password/versions/latest:access",
  );
  assertEquals(
    new Headers(calls[0].init?.headers).get("authorization"),
    "Bearer t0",
  );
});

Deno.test("access honours an explicit version", async () => {
  const { fetch, calls } = fakeFetch(() =>
    new Response(JSON.stringify({ payload: { data: b64("v3") } }), {
      status: 200,
    })
  );
  assertEquals(
    await SecretManagerTasks.access("s", {
      project: "p",
      token: "t0",
      fetch,
      version: "3",
    }),
    "v3",
  );
  assertStringIncludes(calls[0].url, "/versions/3:access");
});

Deno.test("access throws when the response carries no payload", async () => {
  const { fetch } = fakeFetch(() => new Response("{}", { status: 200 }));
  await assertRejects(
    () => SecretManagerTasks.access("s", { project: "p", token: "t0", fetch }),
    Error,
    "no payload",
  );
});

Deno.test("access rejects a non-UTF-8 (binary) payload instead of corrupting it", async () => {
  // Base64 of raw bytes that are not valid UTF-8 (e.g. key material).
  let binary = "";
  for (const byte of [0xff, 0xfe, 0x80]) binary += String.fromCharCode(byte);
  const { fetch } = fakeFetch(() =>
    new Response(JSON.stringify({ payload: { data: btoa(binary) } }), {
      status: 200,
    })
  );
  await assertRejects(
    () =>
      SecretManagerTasks.access("bin", { project: "p", token: "t0", fetch }),
    Error,
    "not valid UTF-8",
  );
});

Deno.test("addVersion creates the secret then adds the version (idempotent on 409)", async () => {
  const seen: Array<{ url: string; method: string; body: string }> = [];
  const { fetch } = fakeFetch((url, init) => {
    seen.push({ url, method: init?.method ?? "GET", body: String(init?.body) });
    if (url.includes(":addVersion")) {
      return new Response(
        JSON.stringify({ name: "projects/p/secrets/s/versions/5" }),
        { status: 200 },
      );
    }
    // The secret already exists → 409, which addVersion must tolerate.
    return new Response(JSON.stringify({ error: "exists" }), { status: 409 });
  });
  const name = await SecretManagerTasks.addVersion("s", "hunter2", {
    project: "p",
    token: "t0",
    fetch,
  });
  assertEquals(name, "projects/p/secrets/s/versions/5");
  assertEquals(seen.length, 2); // create (tolerated 409) then addVersion
  assertStringIncludes(seen[0].url, "/secrets?secretId=s");
  assertEquals(seen[0].method, "POST");
  assertStringIncludes(seen[1].url, "/secrets/s:addVersion");
  assertStringIncludes(seen[1].body, b64("hunter2")); // value base64-encoded
});

Deno.test("addVersion works when the secret is created fresh", async () => {
  const { fetch } = fakeFetch((url) =>
    url.includes(":addVersion")
      ? new Response(JSON.stringify({ name: "n" }), { status: 200 })
      : new Response("{}", { status: 200 })
  );
  assertEquals(
    await SecretManagerTasks.addVersion("s", "v", {
      project: "p",
      token: "t0",
      fetch,
    }),
    "n",
  );
});

Deno.test("addVersion propagates a real create failure (non-409)", async () => {
  const { fetch } = fakeFetch((url) =>
    url.includes(":addVersion")
      ? new Response("{}", { status: 200 })
      : new Response("boom", { status: 500 })
  );
  await assertRejects(
    () =>
      SecretManagerTasks.addVersion("s", "v", {
        project: "p",
        token: "t0",
        fetch,
      }),
    HttpError,
  );
});

Deno.test("the project falls back to the ambient GOOGLE_CLOUD_PROJECT env var", async () => {
  const { fetch } = fakeFetch(() =>
    new Response(JSON.stringify({ payload: { data: b64("x") } }), {
      status: 200,
    })
  );
  // No project and no injected readEnv → the default reader reads the real env.
  Deno.env.set("GOOGLE_CLOUD_PROJECT", "ambient-proj");
  try {
    assertEquals(
      await SecretManagerTasks.access("s", { token: "t0", fetch }),
      "x",
    );
  } finally {
    Deno.env.delete("GOOGLE_CLOUD_PROJECT");
  }
});

Deno.test("the project resolves from the environment, else errors", async () => {
  const { fetch } = fakeFetch(() =>
    new Response(JSON.stringify({ payload: { data: b64("x") } }), {
      status: 200,
    })
  );
  const readEnv = (name: string) =>
    name === "GOOGLE_CLOUD_PROJECT" ? "env-proj" : undefined;
  assertEquals(
    await SecretManagerTasks.access("s", { token: "t0", fetch, readEnv }),
    "x",
  );
  await assertRejects(
    () =>
      SecretManagerTasks.access("s", {
        token: "t0",
        fetch,
        readEnv: () => undefined,
      }),
    Error,
    "no project",
  );
});
