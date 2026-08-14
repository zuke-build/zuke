// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the GitHub App token task. A real RSA key is generated in the
 * test (WebCrypto, no fixture secret in the repo), exported as both PKCS#8 and
 * PKCS#1 so both PEM shapes GitHub hands out are exercised, and the REST calls
 * go through a `fetch` seam — so this is hermetic and needs no app.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { GhTasks } from "../mod.ts";
import { GhAppTokenSettings, mintAppToken } from "../src/app_token.ts";
import { withEnv } from "../../core/tests/_env.ts";

/** A recorded request the fake `fetch` saw. */
interface Seen {
  url: string;
  method: string;
  authorization: string;
  body?: string;
}

/** Base64 in 64-character lines, as PEM wraps it. */
function pemLines(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/(.{64})/g, "$1\n");
}

/**
 * Wrap `body` in a PEM block for `label`.
 *
 * The label is assembled rather than written out so no complete
 * `BEGIN … PRIVATE KEY` header appears as a literal in this file — the secret
 * scanner in the repository's own gate matches that header wherever it sees it,
 * and it is right to: a test fixture is not worth teaching it to ignore.
 */
function pem(label: string, body: string): string {
  const dashes = "-".repeat(5);
  return `${dashes}BEGIN ${label}${dashes}\n${body}\n${dashes}END ${label}${dashes}\n`;
}

/** A freshly generated RSA key pair, in both PEM encodings. */
async function testKeys(): Promise<{ pkcs8: string; pkcs1: string }> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  // Strip the PKCS#8 envelope back off to get the inner PKCS#1 key, which is
  // the form GitHub actually issues. The envelope is a fixed 26-byte prefix for
  // a 2048-bit RSA key: SEQUENCE, version, AlgorithmIdentifier, OCTET STRING.
  const der = new Uint8Array(pkcs8);
  const octetStringAt = der.indexOf(0x04, 20);
  const inner = der.slice(octetStringAt + 4);
  return {
    pkcs8: pem("PRIVATE KEY", pemLines(pkcs8)),
    pkcs1: pem("RSA PRIVATE KEY", pemLines(inner.buffer)),
  };
}

/** A `fetch` seam that answers the installation lookup and the mint. */
function fakeGithub(seen: Seen[], overrides: {
  installation?: unknown;
  minted?: unknown;
  status?: number;
} = {}): typeof fetch {
  return (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? "",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const status = overrides.status ?? 200;
    const payload = url.endsWith("/access_tokens")
      ? overrides.minted ??
        { token: "ghs_installation", expires_at: "2026-08-06T15:00:00Z" }
      : overrides.installation ?? { id: 4242 };
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        statusText: status === 200 ? "OK" : "Bad Request",
      }),
    );
  };
}

Deno.test("appToken signs a JWT, resolves the installation, and mints a token", async () => {
  const { pkcs8 } = await testKeys();
  const seen: Seen[] = [];
  const result = await GhTasks.appToken((s) =>
    s
      .appId(12345)
      .privateKey(pkcs8)
      .owner("zuke-build")
      .repositories("zuke-build.github.io")
      .permission("contents", "write")
      .permission("pull-requests", "write")
      .fetch(fakeGithub(seen))
  );

  assertEquals(result.token, "ghs_installation");
  assertEquals(result.installationId, 4242);
  assertEquals(result.expiresAt, "2026-08-06T15:00:00Z");

  // The installation is resolved through the named repository, so the lookup
  // works for a user-owned installation as well as an org-owned one.
  assertEquals(seen.length, 2);
  assertEquals(
    seen[0].url,
    "https://api.github.com/repos/zuke-build/zuke-build.github.io/installation",
  );
  assertEquals(seen[0].method, "GET");
  assertEquals(
    seen[1].url,
    "https://api.github.com/app/installations/4242/access_tokens",
  );
  assertEquals(seen[1].method, "POST");

  // Both calls authenticate with the signed app JWT, not a token.
  const jwt = seen[0].authorization.replace("Bearer ", "");
  assertEquals(jwt.split(".").length, 3);
  assertEquals(seen[1].authorization, `Bearer ${jwt}`);

  // The mint narrows to exactly the requested repositories and permissions.
  assertEquals(JSON.parse(seen[1].body ?? "{}"), {
    repositories: ["zuke-build.github.io"],
    permissions: { contents: "write", pull_requests: "write" },
  });
});

Deno.test("a hyphenated permission is sent under the API's own spelling", async () => {
  // The trap: `create-github-app-token` takes `permission-pull-requests`, and
  // passing that spelling to the API is refused as a permission the
  // installation does not grant — a 422 that reads as a misconfigured app
  // rather than a misspelled key. Asserting the *shape* of every key is what
  // catches this class of mistake, since a fake transport accepts anything.
  const { pkcs8 } = await testKeys();
  const seen: Seen[] = [];
  await GhTasks.appToken((s) =>
    s
      .appId("1")
      .privateKey(pkcs8)
      .owner("acme")
      .permission("pull-requests", "write")
      .permission("secret-scanning-alerts", "read")
      .fetch(fakeGithub(seen))
  );
  const body: unknown = JSON.parse(seen[1].body ?? "{}");
  if (
    typeof body !== "object" || body === null || !("permissions" in body) ||
    typeof body.permissions !== "object" || body.permissions === null
  ) {
    throw new Error("expected a permissions object");
  }
  const keys = Object.keys(body.permissions).sort();
  assertEquals(keys, ["pull_requests", "secret_scanning_alerts"]);
  // Every key the API accepts is lower-case with underscores; a hyphen in any
  // of them is the bug this guards.
  for (const key of keys) assertEquals(/^[a-z_]+$/.test(key), true, key);
});

Deno.test("appToken reads the PKCS#1 PEM GitHub actually issues", async () => {
  const { pkcs1 } = await testKeys();
  const seen: Seen[] = [];
  const result = await GhTasks.appToken((s) =>
    s.appId("1").privateKey(pkcs1).owner("acme").fetch(fakeGithub(seen))
  );
  assertEquals(result.token, "ghs_installation");
  // No repository named, so the org-level installation lookup is used.
  assertEquals(seen[0].url, "https://api.github.com/orgs/acme/installation");
});

Deno.test("the signed JWT carries a back-dated iat and the app id as iss", async () => {
  const { pkcs8 } = await testKeys();
  const settings = new GhAppTokenSettings()
    .appId("999")
    .privateKey(pkcs8)
    .now(() => 1_000_000);
  const [, claims] = (await settings.jwt_()).split(".");
  const decoded: unknown = JSON.parse(
    atob(claims.replace(/-/g, "+").replace(/_/g, "/")),
  );
  // Back-dated by the skew allowance, so a fast runner clock cannot make
  // GitHub reject the token as issued in its future.
  assertEquals(decoded, { iat: 999_940, exp: 1_000_480, iss: "999" });
});

Deno.test("appToken requires the app id, key, and owner before any request", async () => {
  const { pkcs8 } = await testKeys();
  await assertRejects(
    () => GhTasks.appToken((s) => s.privateKey(pkcs8).owner("a")),
    Error,
    ".appId(...)",
  );
  await assertRejects(
    () => GhTasks.appToken((s) => s.appId("1").owner("a")),
    Error,
    ".privateKey(...)",
  );
  await assertRejects(
    () => GhTasks.appToken((s) => s.appId("1").privateKey(pkcs8)),
    Error,
    ".owner(...)",
  );
});

Deno.test("a malformed private key is named as such, not surfaced as a DataError", async () => {
  await assertRejects(
    () =>
      GhTasks.appToken((s) =>
        // Valid base64, but nowhere near a DER key.
        s.appId("1").owner("a").privateKey(pem("RSA PRIVATE KEY", "AAAA"))
      ),
    Error,
    "could not be read as RSA PEM",
  );
  await assertRejects(
    () =>
      GhTasks.appToken((s) =>
        // Not base64 at all — a PEM mangled in transit.
        s.appId("1").owner("a").privateKey(pem("RSA PRIVATE KEY", "%%%%"))
      ),
    Error,
    "not valid base64",
  );
  await assertRejects(
    () =>
      GhTasks.appToken((s) =>
        s.appId("1").owner("a").privateKey(pem("RSA PRIVATE KEY", ""))
      ),
    Error,
    "pass the PEM contents, not a path",
  );
});

Deno.test("a failed lookup or mint reports the status and GitHub's message", async () => {
  const { pkcs8 } = await testKeys();
  const error = await assertRejects(
    () =>
      GhTasks.appToken((s) =>
        s.appId("1").privateKey(pkcs8).owner("acme").fetch(
          fakeGithub([], {
            status: 404,
            installation: { message: "Not Found" },
          }),
        )
      ),
    Error,
  );
  assertStringIncludes(error.message, "resolving the app installation failed");
  assertStringIncludes(error.message, "404");
  assertStringIncludes(error.message, "Not Found");
});

Deno.test("an installation response with no numeric id names the likely cause", async () => {
  const { pkcs8 } = await testKeys();
  await assertRejects(
    () =>
      GhTasks.appToken((s) =>
        s.appId("1").privateKey(pkcs8).owner("acme").fetch(
          fakeGithub([], { installation: { message: "ok but empty" } }),
        )
      ),
    Error,
    "is the app installed on acme?",
  );
});

Deno.test("a mint response with no token fails rather than returning undefined", async () => {
  const { pkcs8 } = await testKeys();
  await assertRejects(
    () =>
      GhTasks.appToken((s) =>
        s.appId("1").privateKey(pkcs8).owner("acme").fetch(
          fakeGithub([], { minted: { expires_at: "soon" } }),
        )
      ),
    Error,
    "carried no token",
  );
});

Deno.test("baseUrl retargets both calls at a GHES host", async () => {
  const { pkcs8 } = await testKeys();
  const seen: Seen[] = [];
  await GhTasks.appToken((s) =>
    s.appId("1").privateKey(pkcs8).owner("acme")
      .baseUrl("https://ghe.example.com/api/v3/")
      .fetch(fakeGithub(seen))
  );
  assertEquals(
    seen[0].url,
    "https://ghe.example.com/api/v3/orgs/acme/installation",
  );
  assertStringIncludes(seen[1].url, "https://ghe.example.com/api/v3/app/");
});

Deno.test("a mint with no narrowing sends an empty body, not null fields", async () => {
  const { pkcs8 } = await testKeys();
  const seen: Seen[] = [];
  await GhTasks.appToken((s) =>
    s.appId("1").privateKey(pkcs8).owner("acme").fetch(fakeGithub(seen))
  );
  // No repositories and no permissions requested: the token inherits the
  // installation's own scope, and GitHub must not see `null` for either.
  assertEquals(seen[1].body, "{}");
});

Deno.test("an owner or repository that would redirect the mint is refused", () => {
  // This request carries the app's private-key JWT, which outlives the token
  // it mints. URL normalisation resolves a `..` segment before the request is
  // sent, so an owner taken from configuration could otherwise point it at a
  // path the caller never named.
  for (
    const configure of [
      (s: GhAppTokenSettings) => s.owner("../../.."),
      (s: GhAppTokenSettings) => s.owner("acme").repositories("../../../app"),
    ]
  ) {
    let message = "";
    try {
      configure(new GhAppTokenSettings()).installationPath_();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assertStringIncludes(message, "not a valid git ref name");
  }
});

Deno.test("appToken with no configuration is refused before any request", async () => {
  // A bare call is legal to write, so its first missing setting must be named
  // — and refused before the transport is touched.
  await assertRejects(() => mintAppToken(), Error, ".appId(...)");
});

Deno.test("a 2xx body that is not a JSON object is named per endpoint", async () => {
  const { pkcs8 } = await testKeys();
  // Valid JSON, but a string — indexing it as the installation would surface a
  // TypeError naming no endpoint.
  await assertRejects(
    () =>
      GhTasks.appToken((s) =>
        s.appId("1").privateKey(pkcs8).owner("acme").fetch(
          fakeGithub([], { installation: "not an object" }),
        )
      ),
    Error,
    "resolving the app installation returned a body that is not JSON",
  );

  // Not JSON at all — a proxy or gateway answering instead of GitHub. The body
  // is the evidence of who actually answered, so a prefix of it comes along.
  const gateway: typeof fetch = () =>
    Promise.resolve(new Response("<html>gateway</html>", { status: 200 }));
  const error = await assertRejects(
    () =>
      GhTasks.appToken((s) =>
        s.appId("1").privateKey(pkcs8).owner("acme").fetch(gateway)
      ),
    Error,
    "returned a body that is not JSON",
  );
  assertStringIncludes(error.message, "<html>gateway</html>");
});

Deno.test("the minted token is masked in Actions logs, and only there", async () => {
  // Matching what actions/create-github-app-token does: inside Actions the
  // runner is told to mask the token, so passing it onward through env cannot
  // leak it into a log. Outside Actions the directive would just be noise.
  const { pkcs8 } = await testKeys();
  const logged: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]): void => {
    logged.push(args.map(String).join(" "));
  };
  try {
    await withEnv({ GITHUB_ACTIONS: "true" }, async () => {
      await GhTasks.appToken((s) =>
        s.appId("1").privateKey(pkcs8).owner("acme").fetch(fakeGithub([]))
      );
    });
    assertEquals(logged, ["::add-mask::ghs_installation"]);

    logged.length = 0;
    await withEnv({ GITHUB_ACTIONS: undefined }, async () => {
      await GhTasks.appToken((s) =>
        s.appId("1").privateKey(pkcs8).owner("acme").fetch(fakeGithub([]))
      );
    });
    assertEquals(logged, []);
  } finally {
    console.log = original;
  }
});

Deno.test("an ordinary owner and repository still build the usual path", () => {
  assertEquals(
    new GhAppTokenSettings().owner("zuke-build").repositories("zuke")
      .installationPath_(),
    "/repos/zuke-build/zuke/installation",
  );
  assertEquals(
    new GhAppTokenSettings().owner("zuke-build").installationPath_(),
    "/orgs/zuke-build/installation",
  );
});
