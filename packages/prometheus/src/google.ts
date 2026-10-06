// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Google credential source, for Google Cloud Managed Service for
 * Prometheus: Application Default Credentials, resolved without `gcloud`.
 *
 * The search order is the one Google's libraries use:
 *
 * 1. the file `credentialsFile(...)` names, else the one
 *    `GOOGLE_APPLICATION_CREDENTIALS` names (missing is an error);
 * 2. gcloud's well-known file, `application_default_credentials.json` in
 *    `$CLOUDSDK_CONFIG`, `~/.config/gcloud` or, on Windows,
 *    `%APPDATA%\gcloud` (missing moves on);
 * 3. the GCE / GKE metadata server.
 *
 * A file is a `service_account` key (an RS256 JWT assertion exchanged at the
 * key's `token_uri`), an `authorized_user` gcloud login (its refresh token
 * exchanged), or an `external_account` workload identity federation
 * configuration (see `google_external.ts`).
 *
 * @module
 */

import { messageOf } from "./message.ts";
import { signJwtRs256 } from "@zuke/core";
import { authRequestJson, readAuthFile } from "./auth_http.ts";
import type {
  PrometheusCredentials,
  PrometheusCredentialsContext,
  PrometheusHeaders,
} from "./credentials.ts";
import { googleAnswer, googleStep, optionalString } from "./google_answer.ts";
import { externalAccountToken } from "./google_external.ts";
import type { PrometheusGoogleSettings } from "./google_settings.ts";
import { isRecord, own, readString } from "./shape.ts";
import { type Expiring, TokenCache } from "./token_cache.ts";
import { uriEncode } from "./uri.ts";

/** Google's OAuth 2.0 token endpoint, when a file names none. */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** The metadata server's access-token endpoint for the default account. */
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/** How long a signed service-account assertion is valid: Google's maximum. */
const ASSERTION_TTL_SECONDS = 3600;

/** Access tokens, cached per credential identity. */
const tokens = new TokenCache<string>();

/** A credentials file, as read. */
interface CredentialsFile {
  /** Where it was read from, for messages. */
  readonly path: string;
  /** Its parsed contents. */
  readonly json: Record<string, unknown>;
  /** Its raw text, part of the cache identity. */
  readonly text: string;
}

/** POST a form to a token endpoint and read the access token it returns. */
async function exchange(
  context: PrometheusCredentialsContext,
  url: string,
  form: Record<string, string>,
  secrets: readonly string[],
  what: string,
): Promise<Expiring<string>> {
  const step = googleStep(`${what} at ${url}`, secrets);
  const answer = await authRequestJson(context, step, {
    method: "POST",
    url,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });
  return googleAnswer(answer, step, context.now());
}

/**
 * A `service_account` key's token: sign the JWT assertion and exchange it
 * with the `urn:ietf:params:oauth:grant-type:jwt-bearer` grant.
 */
async function serviceAccountToken(
  file: CredentialsFile,
  scopes: readonly string[],
  context: PrometheusCredentialsContext,
): Promise<Expiring<string>> {
  const what = `the credentials file at ${file.path}`;
  const email = readString(file.json, "client_email", `google: ${what}`);
  const key = readString(file.json, "private_key", `google: ${what}`);
  const keyId = own(file.json, "private_key_id");
  const tokenUrl = optionalString(file.json, "token_uri") ?? GOOGLE_TOKEN_URL;
  const issued = Math.floor(context.now() / 1000);
  let assertion: string;
  try {
    assertion = await signJwtRs256(
      key,
      {
        iss: email,
        scope: scopes.join(" "),
        aud: tokenUrl,
        iat: issued,
        exp: issued + ASSERTION_TTL_SECONDS,
      },
      typeof keyId === "string" ? keyId : undefined,
    );
  } catch (error) {
    throw new Error(
      `google: signing the service-account assertion for ${email} failed: ${
        messageOf(error)
      }`,
    );
  }
  return await exchange(
    context,
    tokenUrl,
    {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    },
    [assertion, key],
    "the service-account token exchange",
  );
}

/** An `authorized_user` credential's token: the refresh-token grant. */
async function authorizedUserToken(
  file: CredentialsFile,
  context: PrometheusCredentialsContext,
): Promise<Expiring<string>> {
  const what = `google: the credentials file at ${file.path}`;
  const clientId = readString(file.json, "client_id", what);
  const clientSecret = readString(file.json, "client_secret", what);
  const refreshToken = readString(file.json, "refresh_token", what);
  const tokenUrl = optionalString(file.json, "token_uri") ?? GOOGLE_TOKEN_URL;
  return await exchange(
    context,
    tokenUrl,
    {
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    },
    [clientSecret, refreshToken],
    "the gcloud user token refresh",
  );
}

/** The metadata server's token for the instance's default service account. */
async function metadataToken(
  scopes: readonly string[],
  context: PrometheusCredentialsContext,
): Promise<Expiring<string>> {
  const url = `${METADATA_TOKEN_URL}?scopes=${uriEncode(scopes.join(","))}`;
  const step = googleStep(
    "the metadata server token request (no GOOGLE_APPLICATION_CREDENTIALS " +
      "and no gcloud application-default credentials file were found)",
    [],
  );
  const answer = await authRequestJson(context, step, {
    method: "GET",
    url,
    headers: { "metadata-flavor": "Google" },
  });
  return googleAnswer(answer, step, context.now());
}

/** Join path parts with the platform's separator. */
function joinPath(platform: typeof Deno.build.os, ...parts: string[]): string {
  return parts.join(platform === "windows" ? "\\" : "/");
}

/** gcloud's well-known ADC file, or `undefined` when no base directory is set. */
function wellKnownFile(
  readEnv: (name: string) => string | undefined,
  platform: typeof Deno.build.os,
): string | undefined {
  const name = "application_default_credentials.json";
  const configured = readEnv("CLOUDSDK_CONFIG");
  if (configured !== undefined && configured !== "") {
    return joinPath(platform, configured, name);
  }
  const base = platform === "windows" ? readEnv("APPDATA") : readEnv("HOME");
  if (base === undefined || base === "") return undefined;
  return platform === "windows"
    ? joinPath(platform, base, "gcloud", name)
    : joinPath(platform, base, ".config", "gcloud", name);
}

/** Parse a credentials file's text, failing without quoting it. */
function parseFile(path: string, text: string): CredentialsFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!isRecord(json)) {
    throw new Error(
      `google: the credentials file at ${path} is not a JSON object`,
    );
  }
  return { path, json, text };
}

/**
 * The credentials file ADC resolves to, or `undefined` when there is none and
 * the metadata server is next.
 */
async function locateFile(
  settings: PrometheusGoogleSettings,
  context: PrometheusCredentialsContext,
  platform: typeof Deno.build.os,
): Promise<CredentialsFile | undefined> {
  const named = settings.credentialsFile_ ??
    context.readEnv("GOOGLE_APPLICATION_CREDENTIALS");
  if (named !== undefined && named !== "") {
    const text = await readAuthFile(
      context,
      "google",
      "the credentials file",
      named,
    );
    return parseFile(named, text);
  }
  const path = wellKnownFile(context.readEnv, platform);
  if (path === undefined) return undefined;
  let text: string;
  try {
    text = await context.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw new Error(
      `google: could not read the gcloud credentials file at ${path}: ${
        messageOf(error)
      }`,
    );
  }
  return parseFile(path, text);
}

/** The token a credentials file yields, by its `type`. */
function fileToken(
  file: CredentialsFile,
  scopes: readonly string[],
  context: PrometheusCredentialsContext,
): Promise<Expiring<string>> {
  const type = own(file.json, "type");
  switch (type) {
    case "service_account":
      return serviceAccountToken(file, scopes, context);
    case "authorized_user":
      return authorizedUserToken(file, context);
    case "external_account":
      return externalAccountToken(file.json, file.path, scopes, context);
    default:
      throw new Error(
        `google: the credentials file at ${file.path} has type ${
          JSON.stringify(type)?.slice(0, 40)
        }, which is not supported — use a service_account key, an ` +
          `authorized_user gcloud login or an external_account configuration`,
      );
  }
}

/**
 * The Google credential source: an `Authorization: Bearer` access token from
 * Application Default Credentials, plus `x-goog-user-project` when a quota
 * project is set or the file names one.
 *
 * `platform` decides where gcloud's well-known file lives; the connection
 * passes `Deno.build.os`.
 */
export function googleCredentials(
  settings: PrometheusGoogleSettings,
  platform: typeof Deno.build.os,
): PrometheusCredentials {
  const scopes = settings.scopes_;
  return async (_request, context): Promise<PrometheusHeaders> => {
    const file = await locateFile(settings, context, platform);
    const token = await tokens.get(
      context,
      file === undefined
        ? ["metadata", scopes]
        : ["file", file.path, file.text, scopes],
      () =>
        file === undefined
          ? metadataToken(scopes, context)
          : fileToken(file, scopes, context),
    );
    const project = settings.quotaProject_ ??
      (file === undefined
        ? undefined
        : optionalString(file.json, "quota_project_id"));
    return project === undefined
      ? { authorization: `Bearer ${token}` }
      : { authorization: `Bearer ${token}`, "x-goog-user-project": project };
  };
}
