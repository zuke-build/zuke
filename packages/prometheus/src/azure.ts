// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Azure credential source, for Azure Monitor managed service for
 * Prometheus: a Microsoft Entra ID access token, obtained without `az`.
 *
 * Three credentials, as the Azure Identity libraries define them:
 *
 * - **client secret** — the OAuth 2.0 client-credentials grant at
 *   `<authority>/<tenant>/oauth2/v2.0/token`;
 * - **workload identity** — the same grant with the federated Kubernetes
 *   token as a `client_assertion`;
 * - **managed identity** — the App Service / Functions endpoint when
 *   `IDENTITY_ENDPOINT` and `IDENTITY_HEADER` are set, else the VM's
 *   Instance Metadata Service at `169.254.169.254`.
 *
 * With no explicit choice the order is `DefaultAzureCredential`'s for these
 * three: client secret when `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and
 * `AZURE_CLIENT_SECRET` are all set; else workload identity when
 * `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_FEDERATED_TOKEN_FILE` are;
 * else managed identity.
 *
 * @module
 */

import { envValue } from "./env.ts";
import {
  answerSeconds,
  answerString,
  authRequestJson,
  type AuthStep,
  type PlaintextAllowance,
  readAuthFile,
} from "./auth_http.ts";
import {
  AZURE_PUBLIC_AUTHORITY_HOST,
  type PrometheusAzureCredentialKind,
  type PrometheusAzureSettings,
} from "./azure_settings.ts";
import type {
  PrometheusCredentials,
  PrometheusCredentialsContext,
} from "./credentials.ts";
import { type Expiring, TokenCache } from "./token_cache.ts";

/** The VM Instance Metadata Service's managed-identity token endpoint. */
const IMDS_TOKEN_URL = "http://169.254.169.254/metadata/identity/oauth2/token";

/** Access tokens, cached per credential identity. */
const tokens = new TokenCache<string>();

/** The step descriptor for an Azure request. */
function azureStep(
  step: string,
  secrets: readonly string[],
  plaintext?: PlaintextAllowance,
): AuthStep {
  return { provider: "azure", step, secrets, plaintext };
}

/** The setting when one was made, else the environment variable. */
function setting(
  value: string | undefined,
  env: string,
  context: PrometheusCredentialsContext,
): string | undefined {
  return value ?? envValue(context.readEnv, env);
}

/** A required value, or an error naming the setting and the variable. */
function required(
  value: string | undefined,
  what: string,
  env: string,
): string {
  if (value === undefined) {
    throw new Error(`azure: ${what} needs ${env} (or the matching setting)`);
  }
  return value;
}

/**
 * A tenant id as it may appear in the token URL's path: a GUID or a domain
 * name. Anything else — a `/`, a `?`, a `..` from a tampered environment —
 * would redirect the client secret to another path, so it is refused.
 */
function tenantPath(tenant: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(tenant)) {
    throw new Error(
      "azure: the tenant id must be a GUID or a domain name " +
        "(letters, digits, '.' and '-')",
    );
  }
  return tenant;
}

/**
 * An Entra token answer as an {@link Expiring} token: `expires_in` seconds
 * (a number, or a numeric string from IMDS) from now, else `expires_on`
 * epoch seconds (App Service), else used once.
 */
function azureAnswer(
  answer: Record<string, unknown>,
  step: AuthStep,
  now: number,
): Expiring<string> {
  const token = answerString(answer, "access_token", step);
  const expiresIn = answerSeconds(answer, "expires_in", step);
  if (expiresIn !== undefined) {
    return { value: token, expiresAt: now + expiresIn * 1000 };
  }
  const expiresOn = answerSeconds(answer, "expires_on", step);
  return { value: token, expiresAt: (expiresOn ?? 0) * 1000 };
}

/** The resolved client-credentials grant: tenant, client and authority. */
interface Application {
  /** The token URL. */
  readonly tokenUrl: string;
  /** The client id. */
  readonly clientId: string;
}

/** Resolve the tenant, client and authority into the token URL. */
function application(
  settings: PrometheusAzureSettings,
  context: PrometheusCredentialsContext,
  what: string,
): Application {
  const tenant = tenantPath(
    required(
      setting(settings.tenantId_, "AZURE_TENANT_ID", context),
      what,
      "AZURE_TENANT_ID",
    ),
  );
  const clientId = required(
    setting(settings.clientId_, "AZURE_CLIENT_ID", context),
    what,
    "AZURE_CLIENT_ID",
  );
  const host =
    setting(settings.authorityHost_, "AZURE_AUTHORITY_HOST", context) ??
      AZURE_PUBLIC_AUTHORITY_HOST;
  return {
    tokenUrl: `${host.replace(/\/+$/, "")}/${tenant}/oauth2/v2.0/token`,
    clientId,
  };
}

/** POST the client-credentials grant and read the token. */
async function clientCredentials(
  app: Application,
  form: Record<string, string>,
  secret: string,
  what: string,
  context: PrometheusCredentialsContext,
): Promise<Expiring<string>> {
  const step = azureStep(`${what} at ${app.tokenUrl}`, [secret]);
  const answer = await authRequestJson(context, step, {
    method: "POST",
    url: app.tokenUrl,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: app.clientId,
      ...form,
    }).toString(),
  });
  return azureAnswer(answer, step, context.now());
}

/** The managed-identity resource for a `.default` scope. */
function resourceOf(scope: string): string {
  return scope.replace(/\/\.default$/, "");
}

/** The managed-identity request: App Service's endpoint, or IMDS. */
function managedIdentityRequest(
  settings: PrometheusAzureSettings,
  context: PrometheusCredentialsContext,
): {
  url: string;
  headers: Record<string, string>;
  secrets: string[];
  plaintext: PlaintextAllowance;
} {
  const clientId = setting(settings.clientId_, "AZURE_CLIENT_ID", context);
  const resource = resourceOf(settings.scope_);
  const endpoint = setting(undefined, "IDENTITY_ENDPOINT", context);
  if (endpoint === undefined) {
    const url = new URL(IMDS_TOKEN_URL);
    url.searchParams.set("api-version", "2018-02-01");
    url.searchParams.set("resource", resource);
    if (clientId !== undefined) url.searchParams.set("client_id", clientId);
    return {
      url: url.href,
      headers: { metadata: "true" },
      secrets: [],
      plaintext: "metadata",
    };
  }
  const header = setting(undefined, "IDENTITY_HEADER", context);
  if (
    header === undefined ||
    setting(undefined, "IDENTITY_SERVER_THUMBPRINT", context) !== undefined
  ) {
    throw new Error(
      "azure: IDENTITY_ENDPOINT is set without the App Service " +
        "IDENTITY_HEADER (or with Service Fabric's certificate thumbprint) — " +
        "only the App Service / Functions and VM managed identities are " +
        "supported",
    );
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("azure: IDENTITY_ENDPOINT is not a valid URL");
  }
  url.searchParams.set("api-version", "2019-08-01");
  url.searchParams.set("resource", resource);
  if (clientId !== undefined) url.searchParams.set("client_id", clientId);
  return {
    url: url.href,
    headers: { "x-identity-header": header },
    secrets: [header],
    // On Linux App Service the endpoint is an internal plain-http address
    // (`http://172.x.x.x:8081/msi/token`); the private-network allowance
    // admits exactly that, and the SSRF header must be present to get here.
    plaintext: "private",
  };
}

/** A managed identity's token. */
async function managedIdentityToken(
  settings: PrometheusAzureSettings,
  context: PrometheusCredentialsContext,
): Promise<Expiring<string>> {
  const request = managedIdentityRequest(settings, context);
  const step = azureStep(
    `the managed identity token request to ${request.url}`,
    request.secrets,
    request.plaintext,
  );
  const answer = await authRequestJson(context, step, {
    method: "GET",
    url: request.url,
    headers: request.headers,
  });
  return azureAnswer(answer, step, context.now());
}

/** The credential the settings choose, resolving `"default"` from the env. */
function chooseCredential(
  settings: PrometheusAzureSettings,
  context: PrometheusCredentialsContext,
): Exclude<PrometheusAzureCredentialKind, "default"> {
  if (settings.credential_ !== "default") return settings.credential_;
  const app = ["AZURE_TENANT_ID", "AZURE_CLIENT_ID"].every((name) =>
    setting(undefined, name, context) !== undefined
  );
  if (app && setting(undefined, "AZURE_CLIENT_SECRET", context) !== undefined) {
    return "clientSecret";
  }
  if (
    app &&
    setting(undefined, "AZURE_FEDERATED_TOKEN_FILE", context) !== undefined
  ) {
    return "workloadIdentity";
  }
  return "managedIdentity";
}

/** The token for the chosen credential, through the cache. */
async function azureToken(
  settings: PrometheusAzureSettings,
  context: PrometheusCredentialsContext,
): Promise<string> {
  const scope = settings.scope_;
  switch (chooseCredential(settings, context)) {
    case "clientSecret": {
      const what = "the client secret token request";
      const app = application(settings, context, what);
      const secret = required(
        setting(settings.clientSecret_, "AZURE_CLIENT_SECRET", context),
        what,
        "AZURE_CLIENT_SECRET",
      );
      return await tokens.get(
        context,
        ["secret", app.tokenUrl, app.clientId, secret, scope],
        (shared) =>
          clientCredentials(
            app,
            { scope, client_secret: secret },
            secret,
            what,
            shared,
          ),
      );
    }
    case "workloadIdentity": {
      const what = "the workload identity token request";
      const app = application(settings, context, what);
      const file = required(
        setting(
          settings.federatedTokenFile_,
          "AZURE_FEDERATED_TOKEN_FILE",
          context,
        ),
        what,
        "AZURE_FEDERATED_TOKEN_FILE",
      );
      return await tokens.get(
        context,
        ["workload", app.tokenUrl, app.clientId, file, scope],
        async (shared) => {
          const assertion = (await readAuthFile(
            shared,
            "azure",
            "the federated token",
            file,
          )).trim();
          return await clientCredentials(
            app,
            {
              scope,
              client_assertion_type:
                "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
              client_assertion: assertion,
            },
            assertion,
            what,
            shared,
          );
        },
      );
    }
    case "managedIdentity":
      return await tokens.get(
        context,
        [
          "managed",
          envValue(context.readEnv, "IDENTITY_ENDPOINT"),
          setting(settings.clientId_, "AZURE_CLIENT_ID", context),
          scope,
        ],
        (shared) => managedIdentityToken(settings, shared),
      );
  }
}

/** The Azure credential source: `Authorization: Bearer <Entra token>`. */
export function azureCredentials(
  settings: PrometheusAzureSettings,
): PrometheusCredentials {
  return async (_request, context) => ({
    authorization: `Bearer ${await azureToken(settings, context)}`,
  });
}
