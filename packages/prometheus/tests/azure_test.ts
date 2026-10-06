// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: the Azure credential source — the default order, each credential's
 * exact request (client secret, workload identity, VM and App Service
 * managed identity), the settings that override the environment, caching,
 * and every failure scrubbed.
 */

// cspell:ignore Fprometheus uami

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { InsecureBackendUrlError } from "@zuke/core";
import { PrometheusAzureSettings, PrometheusTasks } from "../mod.ts";
import { azureCredentials } from "../src/azure.ts";
import {
  type Clock,
  context,
  form,
  REQUEST,
  routes,
  type Seams,
  T0,
} from "./_auth.ts";
import { vector } from "./_fetch.ts";

const TENANT = "00000000-0000-0000-0000-000000000001";
const TOKEN_URL =
  `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const IMDS = "http://169.254.169.254/metadata/identity/oauth2/token";
const SCOPE = "https://prometheus.monitor.azure.com/.default";

/** Run the Azure source once. */
async function headers(
  seams: Seams,
  configure: (a: PrometheusAzureSettings) => PrometheusAzureSettings = (a) => a,
) {
  return await azureCredentials(configure(new PrometheusAzureSettings()))(
    REQUEST,
    context(seams),
  );
}

/** An Entra token answer. */
const entra = (token: string) => () =>
  Response.json({
    token_type: "Bearer",
    expires_in: 3599,
    access_token: token,
  });

/** The environment of a service principal with a client secret. */
const SECRET_ENV = {
  AZURE_TENANT_ID: TENANT,
  AZURE_CLIENT_ID: "app-client-id",
  AZURE_CLIENT_SECRET: "app-client-secret-value",
};

Deno.test("the client secret in the environment comes first, and the token is cached", async () => {
  const clock: Clock = { now: T0 };
  const fetcher = routes({ [`POST ${TOKEN_URL}`]: entra("secret-token") });
  const seams: Seams = {
    env: { ...SECRET_ENV, AZURE_FEDERATED_TOKEN_FILE: "/fed" },
    fetch: fetcher,
    clock,
  };
  assertEquals(await headers(seams), {
    authorization: "Bearer secret-token",
  });
  await headers(seams);
  assertEquals(fetcher.sent.length, 1);
  assertEquals(form(fetcher.sent[0].body), {
    grant_type: "client_credentials",
    client_id: "app-client-id",
    scope: SCOPE,
    client_secret: "app-client-secret-value",
  });
  clock.now = T0 + 3599_000;
  await headers(seams);
  assertEquals(fetcher.sent.length, 2);
});

Deno.test("settings override the environment: tenant, client, secret, authority, scope", async () => {
  const fetcher = routes({
    "POST https://login.microsoftonline.us/contoso.onmicrosoft.com/oauth2/v2.0/token":
      entra("gov-token"),
  });
  await headers(
    {
      env: { AZURE_AUTHORITY_HOST: "https://ignored.example" },
      fetch: fetcher,
    },
    (a) =>
      a.tenantId("contoso.onmicrosoft.com").clientId("other-client")
        .authorityHost("https://login.microsoftonline.us/")
        .scope("api://custom/.default").clientSecret("explicit-secret-1"),
  );
  assertEquals(form(fetcher.sent[0].body), {
    grant_type: "client_credentials",
    client_id: "other-client",
    scope: "api://custom/.default",
    client_secret: "explicit-secret-1",
  });
  const env = routes({
    [`POST https://login.chinacloudapi.example/${TENANT}/oauth2/v2.0/token`]:
      entra("t"),
  });
  await headers({
    env: {
      ...SECRET_ENV,
      AZURE_AUTHORITY_HOST: "https://login.chinacloudapi.example//",
    },
    fetch: env,
  });
  assertEquals(env.sent.length, 1);
});

Deno.test("workload identity sends the federated token as the client assertion", async () => {
  const fetcher = routes({ [`POST ${TOKEN_URL}`]: entra("wi-token") });
  const sent = await headers({
    env: {
      AZURE_TENANT_ID: TENANT,
      AZURE_CLIENT_ID: "wi-client",
      AZURE_FEDERATED_TOKEN_FILE:
        "/var/run/secrets/azure/tokens/azure-identity-token",
    },
    files: {
      "/var/run/secrets/azure/tokens/azure-identity-token": "k8s-sa-token\n",
    },
    fetch: fetcher,
  });
  assertEquals(sent, { authorization: "Bearer wi-token" });
  assertEquals(form(fetcher.sent[0].body), {
    grant_type: "client_credentials",
    client_id: "wi-client",
    scope: SCOPE,
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: "k8s-sa-token",
  });
  const explicit = routes({ [`POST ${TOKEN_URL}`]: entra("wi-2") });
  await headers(
    {
      env: { AZURE_TENANT_ID: TENANT, AZURE_CLIENT_ID: "c" },
      files: { "/tok": "t2" },
      fetch: explicit,
    },
    (a) => a.workloadIdentity("/tok"),
  );
  assertEquals(form(explicit.sent[0].body).client_assertion, "t2");
});

Deno.test("with no application configured, the VM's managed identity is asked", async () => {
  const fetcher = routes({
    [`GET ${IMDS}`]: () =>
      Response.json({
        access_token: "vm-token",
        expires_in: "3599",
        expires_on: "1767229199",
        token_type: "Bearer",
      }),
  });
  assertEquals(
    await headers({ env: { AZURE_TENANT_ID: TENANT }, fetch: fetcher }),
    { authorization: "Bearer vm-token" },
  );
  const [request] = fetcher.sent;
  assertEquals(request.headers.get("metadata"), "true");
  assertEquals(
    request.url.search,
    "?api-version=2018-02-01&resource=https%3A%2F%2Fprometheus.monitor.azure.com",
  );
  const user = routes({ [`GET ${IMDS}`]: entra("uami-token") });
  await headers({ fetch: user }, (a) => a.managedIdentity("uami-client-id"));
  assertEquals(
    user.sent[0].url.searchParams.get("client_id"),
    "uami-client-id",
  );
  const fromEnv = routes({ [`GET ${IMDS}`]: entra("env-uami") });
  await headers(
    { env: { AZURE_CLIENT_ID: "env-client" }, fetch: fromEnv },
    (a) => a.managedIdentity().scope("api://other"),
  );
  assertEquals(fromEnv.sent[0].url.searchParams.get("client_id"), "env-client");
  assertEquals(fromEnv.sent[0].url.searchParams.get("resource"), "api://other");
});

Deno.test("App Service's identity endpoint is used when it is configured", async () => {
  const endpoint = "http://127.0.0.1:41056/msi/token";
  const fetcher = routes({
    [`GET ${endpoint}`]: () =>
      Response.json({
        access_token: "app-service-token",
        expires_on: String(T0 / 1000 + 3600),
        resource: "https://prometheus.monitor.azure.com",
        token_type: "Bearer",
      }),
  });
  const seams: Seams = {
    env: {
      IDENTITY_ENDPOINT: endpoint,
      IDENTITY_HEADER: "identity-header-value",
    },
    fetch: fetcher,
  };
  assertEquals(await headers(seams, (a) => a.managedIdentity("app-uami")), {
    authorization: "Bearer app-service-token",
  });
  await headers(seams, (a) => a.managedIdentity("app-uami"));
  assertEquals(fetcher.sent.length, 1);
  const [request] = fetcher.sent;
  assertEquals(
    request.headers.get("x-identity-header"),
    "identity-header-value",
  );
  assertEquals(
    request.url.search,
    "?api-version=2019-08-01&resource=https%3A%2F%2Fprometheus.monitor.azure.com&client_id=app-uami",
  );
  const system = routes({ [`GET ${endpoint}`]: entra("sys") });
  await headers({ ...seams, fetch: system });
  assertEquals(system.sent[0].url.searchParams.has("client_id"), false);
});

Deno.test("an App Service endpoint off loopback must be https, like any token endpoint", async () => {
  const fetcher = routes({});
  await assertRejects(
    () =>
      headers({
        env: {
          IDENTITY_ENDPOINT: "http://10.0.0.5:8081/msi/token",
          IDENTITY_HEADER: "h-value-123",
        },
        fetch: fetcher,
      }),
    InsecureBackendUrlError,
  );
  assertEquals(fetcher.sent.length, 0);
});

Deno.test("unsupported managed-identity environments are refused by name", async () => {
  const cases: Array<[Record<string, string>, string]> = [
    [{
      IDENTITY_ENDPOINT:
        "http://localhost:40342/metadata/identity/oauth2/token",
    }, "without the App Service IDENTITY_HEADER"],
    [
      {
        IDENTITY_ENDPOINT:
          "https://10.0.0.4:2377/metadata/identity/oauth2/token",
        IDENTITY_HEADER: "h",
        IDENTITY_SERVER_THUMBPRINT: "abc",
      },
      "Service Fabric",
    ],
    [
      { IDENTITY_ENDPOINT: "not a url", IDENTITY_HEADER: "h" },
      "IDENTITY_ENDPOINT is not a valid URL",
    ],
  ];
  for (const [env, message] of cases) {
    await assertRejects(() => headers({ env }), Error, message);
  }
});

Deno.test("a missing or malformed setting is named", async () => {
  const cases: Array<
    [
      Record<string, string>,
      (a: PrometheusAzureSettings) => PrometheusAzureSettings,
      string,
    ]
  > = [
    [
      {},
      (a) => a.clientSecret(),
      "azure: the client secret token request needs AZURE_TENANT_ID",
    ],
    [
      { AZURE_TENANT_ID: TENANT },
      (a) => a.clientSecret(),
      "needs AZURE_CLIENT_ID",
    ],
    [
      {
        AZURE_TENANT_ID: TENANT,
        AZURE_CLIENT_ID: "c",
        AZURE_CLIENT_SECRET: "",
      },
      (a) => a.clientSecret(),
      "needs AZURE_CLIENT_SECRET",
    ],
    [
      { AZURE_TENANT_ID: TENANT, AZURE_CLIENT_ID: "c" },
      (a) => a.workloadIdentity(),
      "azure: the workload identity token request needs AZURE_FEDERATED_TOKEN_FILE",
    ],
    [
      {
        AZURE_TENANT_ID: TENANT,
        AZURE_CLIENT_ID: "c",
        AZURE_FEDERATED_TOKEN_FILE: "/none",
      },
      (a) => a.workloadIdentity(),
      "azure: could not read the federated token at /none",
    ],
  ];
  for (const [env, configure, message] of cases) {
    await assertRejects(() => headers({ env }, configure), Error, message);
  }
  for (const tenant of ["../evil", "evil.example/x?", "a#b", ""]) {
    const fetcher = routes({});
    await assertRejects(
      () =>
        headers(
          {
            env: { AZURE_CLIENT_ID: "c", AZURE_CLIENT_SECRET: "s" },
            fetch: fetcher,
          },
          (a) => a.tenantId(tenant).clientSecret(),
        ),
      Error,
      tenant === "" ? "needs AZURE_TENANT_ID" : "the tenant id must be a GUID",
    );
    assertEquals(fetcher.sent.length, 0);
  }
});

Deno.test("a refused token request names the step, never the secret or header", async () => {
  const echo = routes({
    [`POST ${TOKEN_URL}`]: (request) =>
      Response.json({
        error: "invalid_client",
        error_description: `AADSTS7000215: Invalid client secret ${
          form(request.body).client_secret
        }`,
      }, { status: 401 }),
  });
  const error = await assertRejects(
    () => headers({ env: SECRET_ENV, fetch: echo }),
    Error,
    `azure: the client secret token request at ${TOKEN_URL} failed: HTTP 401: ` +
      "invalid_client: AADSTS7000215: Invalid client secret [redacted]",
  );
  assertEquals(error.message.includes("app-client-secret-value"), false);
  const endpoint = "http://127.0.0.1:41056/msi/token";
  const header = routes({
    [`GET ${endpoint}`]: (request) =>
      new Response(`bad header ${request.headers.get("x-identity-header")}`, {
        status: 400,
      }),
  });
  const headerError = await assertRejects(
    () =>
      headers({
        env: {
          IDENTITY_ENDPOINT: endpoint,
          IDENTITY_HEADER: "secret-identity-header",
        },
        fetch: header,
      }),
    Error,
    "azure: the managed identity token request to",
  );
  assertStringIncludes(headerError.message, "bad header [redacted]");
});

Deno.test("an answer with no lifetime is used once, not cached", async () => {
  const fetcher = routes({
    [`GET ${IMDS}`]: () => Response.json({ access_token: "no-expiry" }),
  });
  await headers({ fetch: fetcher });
  await headers({ fetch: fetcher });
  assertEquals(fetcher.sent.length, 2);
});

Deno.test("azure() authenticates a PrometheusTasks query end to end", async () => {
  const fetcher = routes({
    [`POST ${TOKEN_URL}`]: entra("query-token"),
    "POST https://amw.eastus.prometheus.monitor.azure.com/api/v1/query": () =>
      vector(),
  });
  await PrometheusTasks.query((s) =>
    s.url("https://amw.eastus.prometheus.monitor.azure.com").fetch(fetcher)
      .readEnv((name) => new Map(Object.entries(SECRET_ENV)).get(name))
      .azure().query("up")
  );
  assertEquals(
    fetcher.sent[1].headers.get("authorization"),
    "Bearer query-token",
  );
});
