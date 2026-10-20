// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { AppStoreConnectError, AppStoreConnectSettings } from "../mod.ts";
import {
  AppStoreConnectClient,
  resources,
  stringAt,
} from "../src/app_store_connect_client.ts";
import { signToken } from "../src/app_store_connect_token.ts";
import { apiKey, fakeAsc } from "./_asc.ts";
import { rejection } from "./_fake_tool.ts";

const NOW = Date.parse("2026-06-01T00:00:00Z");

function decodePart(part: string): unknown {
  const b64 = part.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
}

function bytesOf(part: string): Uint8Array<ArrayBuffer> {
  const b64 = part.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(
    atob(b64 + "=".repeat((4 - b64.length % 4) % 4)),
    (c) => c.charCodeAt(0),
  );
}

Deno.test("token: ES256, the claims the API wants, a verifiable signature", async () => {
  const key = await apiKey();
  const token = await signToken({
    issuerId: "issuer-uuid",
    keyId: "ABC123",
    privateKey: key.pem,
    now: NOW + 999,
  });
  const [header, payload, signature] = token.split(".");
  assertEquals(decodePart(header), { alg: "ES256", kid: "ABC123", typ: "JWT" });
  assertEquals(decodePart(payload), {
    iss: "issuer-uuid",
    iat: NOW / 1000,
    exp: NOW / 1000 + 1200,
    aud: "appstoreconnect-v1",
  });
  assertEquals(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key.publicKey,
      bytesOf(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    ),
    true,
  );
});

Deno.test("token: a key that is not a P-256 PKCS #8 PEM is refused unquoted", async () => {
  // Assembled at run time: a literal PEM block, even a broken one, is what
  // secret scanners look for.
  const armor = (body: string) =>
    ["BEGIN", "END"].map((edge) => `-----${edge} PRIVATE KEY-----`)
      .join(`\n${body}\n`);
  for (const pem of ["not a key", armor("!!!"), armor("AAAA")]) {
    const error = await rejection(
      () => signToken({ issuerId: "i", keyId: "k", privateKey: pem, now: NOW }),
      Error,
    );
    assertEquals(error.message.includes("is not the PEM of an AuthKey"), true);
    assertEquals(error.message.includes(pem), false);
  }
});

/** Settings with a fresh key, a fixed clock, no real sleeping. */
async function settings(fetcher: typeof fetch): Promise<
  { settings: AppStoreConnectSettings; slept: number[] }
> {
  const key = await apiKey();
  const slept: number[] = [];
  return {
    slept,
    settings: new AppStoreConnectSettings().issuerId("i").keyId("k")
      .privateKey(key.pem).fetch(fetcher).now(() => NOW)
      .sleep((ms) => {
        slept.push(ms);
        return Promise.resolve();
      }),
  };
}

Deno.test("client: JSON:API requests carry the token; reads retry, writes do not", async () => {
  let gets = 0;
  const asc = fakeAsc((call) => {
    if (call.method === "GET") {
      gets++;
      return gets < 3 ? { status: 503 } : { body: { data: [] } };
    }
    return { status: 503 };
  });
  const { settings: s, slept } = await settings(asc.fetch);
  const client = new AppStoreConnectClient(s);
  assertEquals(await client.request("GET", "/v1/apps"), { data: [] });
  assertEquals(slept, [1000, 2000]);
  assertEquals(asc.calls[0].authorization.startsWith("Bearer ey"), true);
  await assertRejects(
    () => client.request("POST", "/v1/x", { data: {} }),
    AppStoreConnectError,
    "POST /v1/x failed with HTTP 503.",
  );
  assertEquals(asc.calls.filter((c) => c.method === "POST").length, 1);
  assertEquals(asc.calls.at(-1)?.body, { data: {} });
});

Deno.test("client: a read gives up after three retries", async () => {
  const asc = fakeAsc(() => ({ status: 429 }));
  const { settings: s } = await settings(asc.fetch);
  await assertRejects(
    () => new AppStoreConnectClient(s).request("GET", "/v1/apps?x=1"),
    AppStoreConnectError,
    "GET /v1/apps failed with HTTP 429",
  );
  assertEquals(asc.calls.length, 4);
});

Deno.test("client: a network error is retried on a read, thrown on a write", async () => {
  let n = 0;
  const flaky: typeof fetch = () => {
    n++;
    return n === 1
      ? Promise.reject(new TypeError("connection reset"))
      : Promise.resolve(new Response(null, { status: 204 }));
  };
  const { settings: s } = await settings(flaky);
  const client = new AppStoreConnectClient(s);
  assertEquals(await client.request("GET", "/v1/a"), undefined);
  n = 0;
  await assertRejects(() => client.request("PATCH", "/v1/a", {}), TypeError);
  const broken: typeof fetch = () => Promise.reject(new RangeError("bug"));
  const { settings: s2 } = await settings(broken);
  await assertRejects(
    () => new AppStoreConnectClient(s2).request("GET", "/v1/a"),
    RangeError,
  );
});

Deno.test("client: the API's errors are listed in the message", async () => {
  const asc = fakeAsc(() => ({
    status: 409,
    body: {
      errors: [
        { code: "ENTITY_ERROR", title: "Bad", detail: "The build is expired." },
        { code: "OTHER", title: "Only a title" },
        { title: "no code" },
      ],
    },
  }));
  const { settings: s } = await settings(asc.fetch);
  const error = await rejection(
    () => new AppStoreConnectClient(s).request("POST", "/v1/b", {}),
    AppStoreConnectError,
  );
  assertEquals(error.status, 409);
  assertEquals(
    error.message,
    "App Store Connect: POST /v1/b failed with HTTP 409:\n" +
      "  - ENTITY_ERROR: The build is expired.\n  - OTHER: Only a title",
  );
  const html: typeof fetch = () =>
    Promise.resolve(new Response("<html>", { status: 401 }));
  const { settings: s2 } = await settings(html);
  const plain = await rejection(
    () => new AppStoreConnectClient(s2).request("GET", "/v1/c"),
    AppStoreConnectError,
  );
  assertEquals(plain.errors, []);
});

Deno.test("client: credentials and the URL are checked", async () => {
  const ok = fakeAsc(() => ({ body: {} }));
  const key = await apiKey();
  const base = () => new AppStoreConnectSettings().fetch(ok.fetch);
  await assertRejects(
    () =>
      new AppStoreConnectClient(base().privateKey(key.pem)).request("GET", "/"),
    Error,
    ".issuerId() and .keyId() are required",
  );
  await assertRejects(
    () =>
      new AppStoreConnectClient(base().issuerId("i").keyId("k")).request(
        "GET",
        "/",
      ),
    Error,
    "set exactly one of .privateKey() and .privateKeyFile()",
  );
  const dir = await Deno.makeTempDir({ prefix: "zuke-asc-" });
  try {
    await Deno.writeTextFile(`${dir}/AuthKey_k.p8`, key.pem);
    const client = new AppStoreConnectClient(
      base().issuerId("i").keyId("k").privateKeyFile(`${dir}/AuthKey_k.p8`),
    );
    await client.request("GET", "/v1/a");
    await Deno.remove(`${dir}/AuthKey_k.p8`);
    // Read once: the second request does not need the file any more.
    await client.request("GET", "/v1/b");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
  let threw = false;
  try {
    new AppStoreConnectClient(
      base().apiUrl("http://asc.example.com").readEnv(() => undefined),
    );
  } catch (error) {
    threw = error instanceof Error && error.message.includes("must use https");
  }
  assertEquals(threw, true);
  // Loopback, for tests and proxies, is allowed.
  new AppStoreConnectClient(base().apiUrl("http://127.0.0.1:9/").log(() => {}));
});

Deno.test("client: the JSON:API readers take whatever shape comes back", () => {
  assertEquals(resources({ data: { id: "one", attributes: { a: 1 } } }), [
    { id: "one", attributes: { a: 1 } },
  ]);
  assertEquals(resources({ data: [{ id: "x" }, "junk", { noId: true }] }), [
    { id: "x", attributes: {} },
  ]);
  assertEquals(resources({}), []);
  assertEquals(resources(null), []);
  assertEquals(stringAt("not an object", "id"), undefined);
  assertEquals(stringAt({ id: 1 }, "id"), undefined);
});

Deno.test("client: the default environment reader is Deno.env", () => {
  Deno.env.set("ZUKE_ALLOW_INSECURE_URL", "1");
  try {
    // Plaintext is accepted only because the opt-out is set in the environment.
    new AppStoreConnectClient(
      new AppStoreConnectSettings().apiUrl("http://asc.example.com"),
    );
  } finally {
    Deno.env.delete("ZUKE_ALLOW_INSECURE_URL");
  }
});
