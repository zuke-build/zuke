// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: the Google credential source — Application Default Credentials
 * search order, the service-account JWT (structure and RS256 signature,
 * checked with a key generated here), the gcloud user refresh, the metadata
 * server, the quota project, caching, and every failure scrubbed.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { PrometheusGoogleSettings, PrometheusTasks } from "../mod.ts";
import { googleCredentials } from "../src/google.ts";
import {
  base64UrlBytes,
  base64UrlJson,
  type Clock,
  context,
  form,
  REQUEST,
  routes,
  rsaKey,
  type Seams,
  T0,
} from "./_auth.ts";
import { fakeFetch, vector } from "./_fetch.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const METADATA =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
/** A PEM label, spelt out at run time so a broken test key is no key to a scanner. */
const LABEL = ["PRIVATE", "KEY"].join(" ");
const READ_SCOPE = "https://www.googleapis.com/auth/monitoring.read";

/** Run the Google source once over `seams`. */
async function headers(
  seams: Seams,
  configure: (g: PrometheusGoogleSettings) => PrometheusGoogleSettings = (g) =>
    g,
  platform: typeof Deno.build.os = "linux",
) {
  return await googleCredentials(
    configure(new PrometheusGoogleSettings()),
    platform,
  )(
    REQUEST,
    context(seams),
  );
}

/** An OAuth token answer. */
function token(value: string, expiresIn: number | null = 3600) {
  return () =>
    Response.json(
      expiresIn === null
        ? { access_token: value, token_type: "Bearer" }
        : { access_token: value, expires_in: expiresIn, token_type: "Bearer" },
    );
}

/** A user credential file. */
const USER = JSON.stringify({
  type: "authorized_user",
  client_id: "client-id.apps.example",
  client_secret: "user-client-secret",
  refresh_token: "user-refresh-token",
});

Deno.test("a service-account key signs an RS256 assertion and exchanges it", async () => {
  const { pem, publicKey } = await rsaKey();
  const fetcher = routes({ [`POST ${TOKEN_URL}`]: token("sa-access-token") });
  const clock: Clock = { now: T0 + 999 };
  const sent = await headers({
    env: { GOOGLE_APPLICATION_CREDENTIALS: "/keys/sa.json" },
    files: {
      "/keys/sa.json": JSON.stringify({
        type: "service_account",
        client_email: "reader@project.iam.gserviceaccount.example",
        private_key: pem,
        private_key_id: "key-id-1",
      }),
    },
    clock,
    fetch: fetcher,
  });
  assertEquals(sent, { authorization: "Bearer sa-access-token" });
  const [request] = fetcher.sent;
  assertEquals(
    request.headers.get("content-type"),
    "application/x-www-form-urlencoded",
  );
  const body = form(request.body);
  assertEquals(
    body.grant_type,
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
  );
  const [header, claims, signature] = body.assertion.split(".");
  assertEquals(base64UrlJson(header), {
    alg: "RS256",
    typ: "JWT",
    kid: "key-id-1",
  });
  const iat = Math.floor(clock.now / 1000);
  assertEquals(base64UrlJson(claims), {
    iss: "reader@project.iam.gserviceaccount.example",
    scope: READ_SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  });
  assertEquals(
    await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      base64UrlBytes(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    ),
    true,
  );
});

Deno.test("a key's token_uri, a missing key id and custom scopes are honoured", async () => {
  const { pem } = await rsaKey();
  const fetcher = routes({
    "POST https://oauth2.internal.example/token": token("t"),
  });
  await headers(
    {
      files: {
        "/k.json": JSON.stringify({
          type: "service_account",
          client_email: "a@b.example",
          private_key: pem,
          token_uri: "https://oauth2.internal.example/token",
        }),
      },
      fetch: fetcher,
    },
    (g) => g.credentialsFile("/k.json").scopes("scope-a", "scope-b"),
  );
  const [header, claims] = form(fetcher.sent[0].body).assertion.split(".");
  assertEquals(base64UrlJson(header), { alg: "RS256", typ: "JWT" });
  const decoded = base64UrlJson(claims);
  assertEquals(
    typeof decoded === "object" && decoded !== null && "scope" in decoded
      ? decoded.scope
      : undefined,
    "scope-a scope-b",
  );
});

Deno.test("an unusable service-account key fails without quoting the key", async () => {
  const key =
    `-----BEGIN ${LABEL}-----\nAAAAsecretKeyMaterialAAA\n-----END ${LABEL}-----`;
  const error = await assertRejects(
    () =>
      headers({
        env: { GOOGLE_APPLICATION_CREDENTIALS: "/k.json" },
        files: {
          "/k.json": JSON.stringify({
            type: "service_account",
            client_email: "a@b.example",
            private_key: key,
          }),
        },
      }),
    Error,
    "google: signing the service-account assertion for a@b.example failed: " +
      "the private key could not be read as RSA PEM",
  );
  assertEquals(error.message.includes("secretKeyMaterial"), false);
});

Deno.test("a credentials file missing a field names the field and the file", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ type: "service_account", private_key: "k" }, "has no client_email"],
    [{ type: "service_account", client_email: "e" }, "has no private_key"],
    [
      { type: "authorized_user", client_secret: "s", refresh_token: "r" },
      "has no client_id",
    ],
  ];
  for (const [json, message] of cases) {
    await assertRejects(
      () =>
        headers({
          env: { GOOGLE_APPLICATION_CREDENTIALS: "/k.json" },
          files: { "/k.json": JSON.stringify(json) },
        }),
      Error,
      `google: the credentials file at /k.json ${message}`,
    );
  }
});

Deno.test("a failed exchange names the step, never the assertion it sent", async () => {
  const { pem } = await rsaKey();
  let assertion = "";
  const fetcher = routes({
    [`POST ${TOKEN_URL}`]: (request) => {
      assertion = form(request.body).assertion;
      return Response.json({
        error: "invalid_grant",
        error_description: `Invalid JWT ${assertion}`,
      }, { status: 400 });
    },
  });
  const error = await assertRejects(
    () =>
      headers({
        env: { GOOGLE_APPLICATION_CREDENTIALS: "/k.json" },
        files: {
          "/k.json": JSON.stringify({
            type: "service_account",
            client_email: "a@b.example",
            private_key: pem,
          }),
        },
        fetch: fetcher,
      }),
    Error,
    `google: the service-account token exchange at ${TOKEN_URL} failed: ` +
      "HTTP 400: invalid_grant: Invalid JWT [redacted]",
  );
  assertEquals(error.message.includes(assertion), false);
});

Deno.test("a gcloud user credential refreshes, and sends its quota project", async () => {
  const fetcher = routes({ [`POST ${TOKEN_URL}`]: token("user-access-token") });
  const sent = await headers({
    env: { HOME: "/home/dev" },
    files: {
      "/home/dev/.config/gcloud/application_default_credentials.json": JSON
        .stringify({ ...JSON.parse(USER), quota_project_id: "billing-proj" }),
    },
    fetch: fetcher,
  });
  assertEquals(sent, {
    authorization: "Bearer user-access-token",
    "x-goog-user-project": "billing-proj",
  });
  assertEquals(form(fetcher.sent[0].body), {
    grant_type: "refresh_token",
    client_id: "client-id.apps.example",
    client_secret: "user-client-secret",
    refresh_token: "user-refresh-token",
  });
});

Deno.test("quotaProject(...) overrides the file's, and a refused refresh hides its secrets", async () => {
  const ok = routes({ [`POST ${TOKEN_URL}`]: token("user-token-2") });
  const sent = await headers(
    { files: { "/u.json": USER }, fetch: ok },
    (g) => g.credentialsFile("/u.json").quotaProject("my-quota"),
  );
  assertEquals(sent["x-goog-user-project"], "my-quota");
  const refused = routes({
    [`POST ${TOKEN_URL}`]: (request) =>
      new Response(`bad ${request.body}`, { status: 401 }),
  });
  const error = await assertRejects(
    () =>
      headers(
        { files: { "/u.json": USER }, fetch: refused },
        (g) => g.credentialsFile("/u.json"),
      ),
    Error,
    "google: the gcloud user token refresh at",
  );
  for (const secret of ["user-client-secret", "user-refresh-token"]) {
    assertEquals(error.message.includes(secret), false, secret);
  }
});

Deno.test("gcloud's well-known file is found under CLOUDSDK_CONFIG and %APPDATA%", async () => {
  const fetcher = routes({ [`POST ${TOKEN_URL}`]: token("t") });
  const config = "/etc/gcloud/application_default_credentials.json";
  await headers({
    env: { CLOUDSDK_CONFIG: "/etc/gcloud", HOME: "/home/dev" },
    files: { [config]: USER },
    fetch: fetcher,
  });
  const windows =
    "C:\\Users\\dev\\AppData\\Roaming\\gcloud\\application_default_credentials.json";
  await headers(
    {
      env: { APPDATA: "C:\\Users\\dev\\AppData\\Roaming" },
      files: { [windows]: USER },
      fetch: fetcher,
    },
    (g) => g,
    "windows",
  );
  await headers(
    {
      env: { CLOUDSDK_CONFIG: "D:\\gcloud" },
      files: { "D:\\gcloud\\application_default_credentials.json": USER },
      fetch: fetcher,
    },
    (g) => g,
    "windows",
  );
  assertEquals(fetcher.sent.length, 3);
});

Deno.test("with no file, the metadata server is asked, over its plaintext link", async () => {
  const fetcher = routes({ [`GET ${METADATA}`]: token("gce-token") });
  const envs: Array<Record<string, string>> = [
    { HOME: "/home/dev" },
    {},
    { HOME: "" },
  ];
  for (const env of envs) {
    assertEquals(
      await headers(
        { env, fetch: fetcher },
        (g) => g.scopes("a b", READ_SCOPE),
      ),
      { authorization: "Bearer gce-token" },
    );
  }
  const [request] = fetcher.sent;
  assertEquals(request.headers.get("metadata-flavor"), "Google");
  assertEquals(
    request.url.search,
    `?scopes=a%20b%2C${encodeURIComponent(READ_SCOPE)}`,
  );
  await headers({ env: {}, fetch: fetcher }, (g) => g, "windows");
});

Deno.test("an unreachable metadata server says no credentials were found", async () => {
  await assertRejects(
    () =>
      headers({
        fetch: fakeFetch(() => {
          throw new TypeError("dns error: metadata.google.internal");
        }),
      }),
    Error,
    "google: the metadata server token request (no " +
      "GOOGLE_APPLICATION_CREDENTIALS and no gcloud application-default " +
      "credentials file were found) failed: dns error",
  );
});

Deno.test("a named file that is missing, unreadable, not JSON or of another type fails", async () => {
  const cases: Array<[Seams, string]> = [
    [
      { env: { GOOGLE_APPLICATION_CREDENTIALS: "/missing.json" } },
      "google: could not read the credentials file at /missing.json",
    ],
    [
      {
        env: { GOOGLE_APPLICATION_CREDENTIALS: "/k.json" },
        files: { "/k.json": "secret-not-json" },
      },
      "google: the credentials file at /k.json is not a JSON object",
    ],
    [
      {
        env: { GOOGLE_APPLICATION_CREDENTIALS: "/k.json" },
        files: {
          "/k.json": JSON.stringify({ type: "impersonated_service_account" }),
        },
      },
      'has type "impersonated_service_account", which is not supported',
    ],
    [
      {
        env: { GOOGLE_APPLICATION_CREDENTIALS: "/k.json" },
        files: { "/k.json": "{}" },
      },
      "has type undefined, which is not supported",
    ],
  ];
  for (const [seams, message] of cases) {
    const error = await assertRejects(() => headers(seams), Error, message);
    assertEquals(error.message.includes("secret-not-json"), false);
  }
  const denied = {
    ...context({ env: { HOME: "/h" } }),
    readTextFile: () => Promise.reject(new Error("permission denied")),
  };
  await assertRejects(
    async () =>
      await googleCredentials(new PrometheusGoogleSettings(), "linux")(
        REQUEST,
        denied,
      ),
    Error,
    "google: could not read the gcloud credentials file at " +
      "/h/.config/gcloud/application_default_credentials.json: permission denied",
  );
  const odd = {
    ...context({ env: { HOME: "/h" } }),
    readTextFile: () => Promise.reject("denied"),
  };
  await assertRejects(
    async () =>
      await googleCredentials(new PrometheusGoogleSettings(), "linux")(
        REQUEST,
        odd,
      ),
    Error,
    "application_default_credentials.json: denied",
  );
});

Deno.test("scopes(...) needs at least one non-empty scope", () => {
  for (const scopes of [[], [""]]) {
    let message = "";
    try {
      new PrometheusGoogleSettings().scopes(...scopes);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    assertStringIncludes(message, "at least one non-empty scope");
  }
});

Deno.test("a token is cached until shortly before expiry, and one without a lifetime is not", async () => {
  const clock: Clock = { now: T0 };
  const fetcher = routes({ [`POST ${TOKEN_URL}`]: token("cached") });
  const seams: Seams = { files: { "/u.json": USER }, fetch: fetcher, clock };
  const named = (g: PrometheusGoogleSettings) => g.credentialsFile("/u.json");
  await headers(seams, named);
  await headers(seams, named);
  assertEquals(fetcher.sent.length, 1);
  clock.now = T0 + 56 * 60_000;
  await headers(seams, named);
  assertEquals(fetcher.sent.length, 2);
  const once = routes({ [`POST ${TOKEN_URL}`]: token("once", null) });
  const onceSeams: Seams = { files: { "/u.json": USER }, fetch: once, clock };
  await headers(onceSeams, named);
  await headers(onceSeams, named);
  assertEquals(once.sent.length, 2);
});

Deno.test("google() authenticates a PrometheusTasks query end to end", async () => {
  const fetcher = routes({
    [`GET ${METADATA}`]: token("gce-query-token"),
    "POST https://monitoring.googleapis.com/v1/projects/p/location/global/prometheus/api/v1/query":
      () => vector(),
  });
  await PrometheusTasks.query((s) =>
    s.url(
      "https://monitoring.googleapis.com/v1/projects/p/location/global/prometheus",
    ).fetch(fetcher).readEnv(() => undefined).google().query("up")
  );
  assertEquals(
    fetcher.sent[1].headers.get("authorization"),
    "Bearer gce-query-token",
  );
});
