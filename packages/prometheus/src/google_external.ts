// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Google workload identity federation: an `external_account` credentials
 * file, as `gcloud iam workload-identity-pools create-cred-config` writes it
 * (and as `google-github-actions/auth` writes it for a GitHub Actions OIDC
 * token).
 *
 * The flow is RFC 8693 token exchange: read the subject token the file's
 * `credential_source` points at, exchange it at the Security Token Service
 * (`token_url`, `https://sts.googleapis.com/v1/token`) for a federated access
 * token, and — when the file names a `service_account_impersonation_url` —
 * exchange that for a service account's access token through the IAM
 * Credentials `generateAccessToken` method.
 *
 * Supported subject-token sources: a `file`, and a `url` (with its `headers`),
 * each in `text` or `json` format. The `aws1` environment source (which signs
 * an AWS `GetCallerIdentity` request) and the `executable` source are refused
 * by name.
 *
 * @module
 */

import {
  answerString,
  authRequest,
  authRequestJson,
  readAuthFile,
} from "./auth_http.ts";
import type { PrometheusCredentialsContext } from "./credentials.ts";
import { googleAnswer, googleStep, optionalString } from "./google_answer.ts";
import { isRecord, own, readString } from "./shape.ts";
import type { Expiring } from "./token_cache.ts";

/** The Security Token Service endpoint, when the file names none. */
const STS_TOKEN_URL = "https://sts.googleapis.com/v1/token";

/** The scope a federated token is requested with before impersonation. */
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** The impersonated token's lifetime when the file sets none: one hour. */
const DEFAULT_IMPERSONATION_SECONDS = 3600;

/** The `credential_source` object, or an error naming the file. */
function credentialSource(
  json: Record<string, unknown>,
  what: string,
): Record<string, unknown> {
  const source = own(json, "credential_source");
  if (!isRecord(source)) throw new Error(`${what} has no credential_source`);
  return source;
}

/** The subject token from `text`, in the source's `format`. */
function subjectFromText(
  text: string,
  source: Record<string, unknown>,
  what: string,
): string {
  const format = own(source, "format");
  const type = isRecord(format) ? own(format, "type") : undefined;
  if (type === undefined || type === "text") return text.trim();
  if (type !== "json" || !isRecord(format)) {
    throw new Error(
      `${what}: credential_source.format.type must be "text" or "json"`,
    );
  }
  const field = readString(
    format,
    "subject_token_field_name",
    `${what}: credential_source.format`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const token = isRecord(parsed) ? own(parsed, field) : undefined;
  if (typeof token !== "string" || token === "") {
    throw new Error(
      `${what}: the subject token source has no "${field}" string field`,
    );
  }
  return token;
}

/** Read the subject token the file's `credential_source` names. */
async function subjectToken(
  json: Record<string, unknown>,
  what: string,
  context: PrometheusCredentialsContext,
): Promise<string> {
  const source = credentialSource(json, what);
  if (own(source, "environment_id") !== undefined) {
    throw new Error(
      `${what}: the AWS credential_source (environment_id) is not ` +
        `supported — federate from AWS with a file or url source, or use a ` +
        `service_account key`,
    );
  }
  if (own(source, "executable") !== undefined) {
    throw new Error(
      `${what}: the executable credential_source is not supported — ` +
        `write the subject token to a file and use a file source`,
    );
  }
  const file = own(source, "file");
  if (typeof file === "string" && file !== "") {
    const text = await readAuthFile(
      context,
      "google",
      "the workload identity subject token",
      file,
    );
    return subjectFromText(text, source, what);
  }
  const url = own(source, "url");
  if (typeof url === "string" && url !== "") {
    const headers = own(source, "headers");
    const sent: Record<string, string> = {};
    if (isRecord(headers)) {
      for (const [name, value] of Object.entries(headers)) {
        if (typeof value === "string") sent[name] = value;
      }
    }
    const text = await authRequest(
      context,
      googleStep(
        `reading the workload identity subject token from ${url}`,
        Object.values(sent),
      ),
      { method: "GET", url, headers: sent },
    );
    return subjectFromText(text, source, what);
  }
  throw new Error(
    `${what}: credential_source names neither a file nor a url`,
  );
}

/** The impersonated token's lifetime, from the file or the default. */
function impersonationLifetime(json: Record<string, unknown>): number {
  const options = own(json, "service_account_impersonation");
  const seconds = isRecord(options)
    ? own(options, "token_lifetime_seconds")
    : undefined;
  return typeof seconds === "number" && Number.isSafeInteger(seconds) &&
      seconds > 0
    ? seconds
    : DEFAULT_IMPERSONATION_SECONDS;
}

/** Exchange the federated token for a service account's access token. */
async function impersonate(
  url: string,
  federated: string,
  scopes: readonly string[],
  lifetime: number,
  context: PrometheusCredentialsContext,
): Promise<Expiring<string>> {
  const step = googleStep(
    `the service account impersonation at ${url}`,
    [federated],
  );
  const answer = await authRequestJson(context, step, {
    method: "POST",
    url,
    headers: {
      authorization: `Bearer ${federated}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ scope: scopes, lifetime: `${lifetime}s` }),
  });
  const token = answerString(answer, "accessToken", step);
  const expires = Date.parse(answerString(answer, "expireTime", step));
  if (Number.isNaN(expires)) {
    throw new Error(
      `google: ${step.step} failed: the answer's expireTime is not a time`,
    );
  }
  return { value: token, expiresAt: expires };
}

/**
 * An `external_account` file's access token: subject token, STS exchange,
 * and impersonation when configured.
 */
export async function externalAccountToken(
  json: Record<string, unknown>,
  path: string,
  scopes: readonly string[],
  context: PrometheusCredentialsContext,
): Promise<Expiring<string>> {
  const what = `google: the credentials file at ${path}`;
  const audience = readString(json, "audience", what);
  const subjectType = readString(json, "subject_token_type", what);
  const tokenUrl = optionalString(json, "token_url") ?? STS_TOKEN_URL;
  const impersonationUrl = optionalString(
    json,
    "service_account_impersonation_url",
  );
  const userProject = optionalString(json, "workforce_pool_user_project");
  const subject = await subjectToken(json, what, context);
  const form: Record<string, string> = {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience,
    scope: impersonationUrl === undefined
      ? scopes.join(" ")
      : CLOUD_PLATFORM_SCOPE,
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token: subject,
    subject_token_type: subjectType,
  };
  // A workforce pool without impersonation bills its quota to this project.
  if (userProject !== undefined && impersonationUrl === undefined) {
    form.options = JSON.stringify({ userProject });
  }
  const step = googleStep(
    `the workload identity token exchange at ${tokenUrl}`,
    [subject],
  );
  const answer = await authRequestJson(context, step, {
    method: "POST",
    url: tokenUrl,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });
  const federated = googleAnswer(answer, step, context.now());
  if (impersonationUrl === undefined) return federated;
  return await impersonate(
    impersonationUrl,
    federated.value,
    scopes,
    impersonationLifetime(json),
    context,
  );
}
