// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: Google workload identity federation (`external_account`) — the file
 * and url subject-token sources in text and json formats, the STS token
 * exchange, service-account impersonation, workforce pools, the refused
 * sources, and the subject token kept out of every error.
 */

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { PrometheusGoogleSettings } from "../mod.ts";
import { googleCredentials } from "../src/google.ts";
import { context, form, REQUEST, routes, type Seams, T0 } from "./_auth.ts";

const STS = "https://sts.googleapis.com/v1/token";
const IMPERSONATE =
  "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sa@p.iam.gserviceaccount.example:generateAccessToken";
const AUDIENCE =
  "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/pool/providers/github";
const JWT_TYPE = "urn:ietf:params:oauth:token-type:jwt";

/** An external_account file over `source`, plus `extra` fields. */
function account(
  source: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: "external_account",
    audience: AUDIENCE,
    subject_token_type: JWT_TYPE,
    credential_source: source,
    ...extra,
  });
}

/** Run the Google source with `file` as the credentials file. */
async function headers(file: string, seams: Seams) {
  return await googleCredentials(
    new PrometheusGoogleSettings().credentialsFile("/wif.json"),
    "linux",
  )(
    REQUEST,
    context({ ...seams, files: { "/wif.json": file, ...seams.files } }),
  );
}

/** An STS answer. */
const sts = () =>
  Response.json({
    access_token: "federated-token",
    issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
    token_type: "Bearer",
    expires_in: 3600,
  });

Deno.test("a file subject token is exchanged at STS for the requested scope", async () => {
  const fetcher = routes({ [`POST ${STS}`]: sts });
  const sent = await headers(account({ file: "/var/run/oidc" }), {
    files: { "/var/run/oidc": "oidc-subject-token\n" },
    fetch: fetcher,
  });
  assertEquals(sent, { authorization: "Bearer federated-token" });
  assertEquals(form(fetcher.sent[0].body), {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience: AUDIENCE,
    scope: "https://www.googleapis.com/auth/monitoring.read",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token: "oidc-subject-token",
    subject_token_type: JWT_TYPE,
  });
});

Deno.test("a url source in json format sends its headers and reads the named field", async () => {
  const fetcher = routes({
    "GET http://169.254.169.254/metadata/identity/oauth2/token": () =>
      Response.json({ access_token: "azure-subject-token" }),
    "POST https://sts.example/v1/token": sts,
  });
  await headers(
    account({
      url: "http://169.254.169.254/metadata/identity/oauth2/token?resource=x",
      headers: { Metadata: "True", ignored: 1 },
      format: { type: "json", subject_token_field_name: "access_token" },
    }, { token_url: "https://sts.example/v1/token" }),
    { fetch: fetcher },
  );
  assertEquals(fetcher.sent[0].headers.get("metadata"), "True");
  assertEquals(fetcher.sent[0].headers.has("ignored"), false);
  assertEquals(
    form(fetcher.sent[1].body).subject_token,
    "azure-subject-token",
  );
  await headers(
    account({ url: "https://idp.example/token", format: { type: "text" } }, {
      token_url: "https://sts.example/v1/token",
    }),
    {
      fetch: routes({
        "GET https://idp.example/token": () => new Response("text-subject"),
        "POST https://sts.example/v1/token": sts,
      }),
    },
  );
});

Deno.test("impersonation exchanges the federated token for the service account's", async () => {
  const fetcher = routes({
    [`POST ${STS}`]: sts,
    [`POST ${IMPERSONATE}`]: () =>
      Response.json({
        accessToken: "impersonated-token",
        expireTime: "2026-01-01T01:00:00Z",
      }),
  });
  const sent = await headers(
    account({ file: "/oidc" }, {
      service_account_impersonation_url: IMPERSONATE,
      service_account_impersonation: { token_lifetime_seconds: 600 },
      workforce_pool_user_project: "ignored-when-impersonating",
    }),
    { files: { "/oidc": "subject" }, fetch: fetcher },
  );
  assertEquals(sent, { authorization: "Bearer impersonated-token" });
  const exchange = form(fetcher.sent[0].body);
  assertEquals(
    exchange.scope,
    "https://www.googleapis.com/auth/cloud-platform",
  );
  assertEquals(exchange.options, undefined);
  const [, impersonate] = fetcher.sent;
  assertEquals(
    impersonate.headers.get("authorization"),
    "Bearer federated-token",
  );
  assertEquals(impersonate.headers.get("content-type"), "application/json");
  assertEquals(JSON.parse(impersonate.body), {
    scope: ["https://www.googleapis.com/auth/monitoring.read"],
    lifetime: "600s",
  });
  // The default lifetime, when the file sets none (or nonsense).
  for (const options of [undefined, { token_lifetime_seconds: "long" }]) {
    const again = routes({
      [`POST ${STS}`]: sts,
      [`POST ${IMPERSONATE}`]: () =>
        Response.json({ accessToken: "t", expireTime: "2026-01-01T01:00:00Z" }),
    });
    await headers(
      account({ file: "/oidc" }, {
        service_account_impersonation_url: IMPERSONATE,
        service_account_impersonation: options,
        audience: `${AUDIENCE}-${String(options)}`,
      }),
      { files: { "/oidc": "subject" }, fetch: again },
    );
    assertEquals(JSON.parse(again.sent[1].body).lifetime, "3600s");
  }
});

Deno.test("a workforce pool without impersonation names its user project", async () => {
  const fetcher = routes({ [`POST ${STS}`]: sts });
  await headers(
    account({ file: "/oidc" }, { workforce_pool_user_project: "wf-project" }),
    { files: { "/oidc": "subject" }, fetch: fetcher },
  );
  assertEquals(
    form(fetcher.sent[0].body).options,
    JSON.stringify({ userProject: "wf-project" }),
  );
});

Deno.test("unsupported or malformed subject-token sources are refused by name", async () => {
  const cases: Array<[string, Record<string, string>, string]> = [
    [
      JSON.stringify({
        type: "external_account",
        audience: "a",
        subject_token_type: "t",
      }),
      {},
      "has no credential_source",
    ],
    [
      account({ environment_id: "aws1" }),
      {},
      "the AWS credential_source (environment_id) is not supported",
    ],
    [
      account({ executable: { command: "x" } }),
      {},
      "the executable credential_source is not supported",
    ],
    [account({ file: "" }), {}, "names neither a file nor a url"],
    [
      account({ file: "/oidc", format: { type: "xml" } }),
      { "/oidc": "s" },
      'credential_source.format.type must be "text" or "json"',
    ],
    [
      account({ file: "/oidc", format: { type: "json" } }),
      { "/oidc": "{}" },
      "credential_source.format has no subject_token_field_name",
    ],
    [
      account({
        file: "/oidc",
        format: { type: "json", subject_token_field_name: "id_token" },
      }),
      { "/oidc": "secret-subject-not-json" },
      'the subject token source has no "id_token" string field',
    ],
    [
      account({
        file: "/oidc",
        format: { type: "json", subject_token_field_name: "id_token" },
      }),
      { "/oidc": '{"id_token": 5}' },
      'has no "id_token" string field',
    ],
    [
      JSON.stringify({
        type: "external_account",
        subject_token_type: "t",
        credential_source: { file: "/oidc" },
      }),
      {},
      "has no audience",
    ],
    [
      account({ file: "/missing" }),
      {},
      "google: could not read the workload identity subject token at /missing",
    ],
  ];
  for (const [file, files, message] of cases) {
    const error = await assertRejects(
      () => headers(file, { files }),
      Error,
      message,
    );
    assertEquals(error.message.includes("secret-subject"), false);
  }
});

Deno.test("a refused exchange or impersonation names the step, never the tokens", async () => {
  const refused = routes({
    [`POST ${STS}`]: (request) =>
      Response.json({
        error: "invalid_grant",
        error_description: `bad ${form(request.body).subject_token}`,
      }, { status: 400 }),
  });
  const error = await assertRejects(
    () =>
      headers(account({ file: "/oidc" }), {
        files: { "/oidc": "secret-subject-token" },
        fetch: refused,
      }),
    Error,
    `google: the workload identity token exchange at ${STS} failed: HTTP 400: ` +
      "invalid_grant: bad [redacted]",
  );
  assertEquals(error.message.includes("secret-subject-token"), false);
  const failures: Array<[Response, string]> = [
    [
      Response.json({ error: { message: "echo federated-token" } }, {
        status: 403,
      }),
      "HTTP 403: echo [redacted]",
    ],
    [
      Response.json({ accessToken: "t", expireTime: "whenever" }),
      "the answer's expireTime is not a time",
    ],
  ];
  for (const [answer, message] of failures) {
    await assertRejects(
      () =>
        headers(
          account({ file: "/oidc" }, {
            service_account_impersonation_url: IMPERSONATE,
            audience: `${AUDIENCE}-${message}`,
          }),
          {
            files: { "/oidc": "s" },
            fetch: routes({
              [`POST ${STS}`]: sts,
              [`POST ${IMPERSONATE}`]: () => answer,
            }),
            clock: { now: T0 },
          },
        ),
      Error,
      message,
    );
  }
});
