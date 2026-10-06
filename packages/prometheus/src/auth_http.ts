// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one way a built-in credential source talks to a token endpoint — an
 * OAuth server, a cloud metadata service, STS — and the one rule for which
 * plaintext endpoints it may use.
 *
 * Every token request the Google, Azure and AWS sources make goes through
 * {@link authRequest}, so each guard is applied to all of them: the endpoint
 * check, redirects never followed, the response size cap, the caller's
 * timeout and cancellation, and an error that names the provider and the step
 * but never the secret, assertion or token involved.
 *
 * @module
 */

import { messageOf } from "./message.ts";
import {
  assertSecureBackendUrl,
  readBytesBounded,
  Redactor,
  redactUrls,
} from "@zuke/core";
import {
  type PrometheusCredentialsContext,
  registerSecrets,
} from "./credentials.ts";
import { isRecord, own } from "./shape.ts";

/** The largest token-endpoint answer read: a token response is a few KiB. */
const MAX_AUTH_RESPONSE_BYTES = 1024 * 1024;

/** The longest server-supplied text an error carries. */
const MAX_DETAIL = 300;

/**
 * The plaintext endpoints a credential source may reach without
 * `ZUKE_ALLOW_INSECURE_URL`: each cloud's link-local metadata service, which
 * is plaintext by design and reachable only from the machine itself. Matched
 * on the parsed URL's exact hostname, on port 80 — `169.254.169.254.evil.com`
 * or `169.254.169.254@evil.com` parse to other hosts and are not on it.
 *
 * - `metadata.google.internal` — the GCE / GKE metadata server.
 * - `169.254.169.254` — Azure IMDS and EC2 IMDS.
 * - `169.254.170.2` — the ECS task credentials endpoint.
 * - `169.254.170.23` and `[fd00:ec2::23]` — the EKS Pod Identity agent.
 */
const METADATA_HOSTS: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "169.254.169.254",
  "169.254.170.2",
  "169.254.170.23",
  "[fd00:ec2::23]",
]);

/** One request to a token endpoint. */
export interface AuthRequest {
  /** The HTTP method. */
  readonly method: "GET" | "POST" | "PUT";
  /** The absolute URL. */
  readonly url: string;
  /** The request headers. */
  readonly headers: Readonly<Record<string, string>>;
  /** The body: a form or a JSON document. Absent on a `GET`. */
  readonly body?: string;
}

/** Who is asking, for the error message, and what it must never contain. */
export interface AuthStep {
  /** The provider, such as `google` or `aws`. */
  readonly provider: string;
  /** The step, such as `the token exchange at https://…`. */
  readonly step: string;
  /** Every secret the request carries, masked in any error it raises. */
  readonly secrets: readonly string[];
}

/**
 * Refuse a plaintext token endpoint, exactly as the Prometheus URL is refused
 * — except the metadata services in {@link METADATA_HOSTS}.
 */
function assertAuthEndpoint(
  raw: string,
  what: string,
  readEnv: (name: string) => string | undefined,
): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${what} is not a valid URL`);
  }
  if (
    url.protocol === "http:" && url.port === "" &&
    METADATA_HOSTS.has(url.hostname)
  ) {
    return;
  }
  assertSecureBackendUrl(raw, what, readEnv);
}

/** A redactor over `secrets`, registered as any credential header value is. */
function redactorOf(secrets: readonly string[]): Redactor {
  const redactor = new Redactor();
  for (const secret of secrets) registerSecrets(redactor, secret);
  return redactor;
}

/** `text` scrubbed of `secrets` and URL credentials, collapsed and capped. */
function scrub(redactor: Redactor, text: string): string {
  const clean = redactUrls(redactor.redact(text)).replace(/\s+/g, " ").trim();
  return clean.length > MAX_DETAIL ? `${clean.slice(0, MAX_DETAIL)}…` : clean;
}

/**
 * The part of an error answer worth reporting: OAuth's `error` and
 * `error_description`, a Google API's `error.message`, an AWS `<Code>` and
 * `<Message>`, or else the start of the body.
 */
function errorDetail(text: string): string {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const code = /<Code>([^<]*)<\/Code>/.exec(text);
    const message = /<Message>([^<]*)<\/Message>/.exec(text);
    if (code !== null || message !== null) {
      return [code?.[1], message?.[1]].filter((part) => part !== undefined)
        .join(": ");
    }
    return text;
  }
  if (!isRecord(json)) return text;
  const error = own(json, "error");
  const description = own(json, "error_description");
  if (typeof error === "string") {
    return typeof description === "string" ? `${error}: ${description}` : error;
  }
  if (isRecord(error) && typeof own(error, "message") === "string") {
    return String(own(error, "message"));
  }
  return text;
}

/**
 * Send one token-endpoint request and return the answer's text when it is a
 * 2xx. Anything else — a refused endpoint, a network failure, a redirect, a
 * non-2xx, an answer over the cap — throws an `Error` reading
 * `<provider>: <step> failed: <why>`, with every secret masked.
 */
export async function authRequest(
  context: PrometheusCredentialsContext,
  step: AuthStep,
  request: AuthRequest,
): Promise<string> {
  const redactor = redactorOf(step.secrets);
  const fail = (why: string) =>
    new Error(
      `${step.provider}: ${step.step} failed: ${scrub(redactor, why)}`,
    );
  assertAuthEndpoint(
    request.url,
    `the ${step.provider} credential endpoint for ${step.step}`,
    context.readEnv,
  );
  let response: Response;
  try {
    response = await context.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: context.signal,
      redirect: "manual",
    });
  } catch (error) {
    throw fail(messageOf(error));
  }
  if (
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400)
  ) {
    await response.body?.cancel();
    throw fail(`HTTP ${response.status}, a redirect, which is not followed`);
  }
  const bytes = await readBytesBounded(response.body, MAX_AUTH_RESPONSE_BYTES);
  if (bytes === null) {
    throw fail(`the answer is larger than ${MAX_AUTH_RESPONSE_BYTES} bytes`);
  }
  const text = new TextDecoder().decode(bytes);
  if (!response.ok) {
    const detail = errorDetail(text);
    throw fail(`HTTP ${response.status}${detail === "" ? "" : `: ${detail}`}`);
  }
  return text;
}

/**
 * {@link authRequest}, with the answer parsed as a JSON object. An answer
 * that is not one fails naming the step (and never quoting the body, which
 * on a 2xx is where a token would be).
 */
export async function authRequestJson(
  context: PrometheusCredentialsContext,
  step: AuthStep,
  request: AuthRequest,
): Promise<Record<string, unknown>> {
  const text = await authRequest(context, step, request);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!isRecord(json)) {
    throw new Error(
      `${step.provider}: ${step.step} failed: the answer is not a JSON object`,
    );
  }
  return json;
}

/**
 * A required string field of a token answer — `access_token`,
 * `AccessKeyId` — or an error naming the field and the step, never the value
 * of any other field.
 */
export function answerString(
  answer: Record<string, unknown>,
  key: string,
  step: AuthStep,
): string {
  const value = own(answer, key);
  if (typeof value !== "string" || value === "") {
    throw new Error(
      `${step.provider}: ${step.step} failed: the answer has no ${key}`,
    );
  }
  return value;
}

/**
 * A token answer's lifetime field as seconds — a number, or a numeric string
 * as Azure's managed-identity endpoints send it — or `undefined` when absent.
 */
export function answerSeconds(
  answer: Record<string, unknown>,
  key: string,
  step: AuthStep,
): number | undefined {
  const value = own(answer, key);
  if (value === undefined) return undefined;
  const seconds = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    throw new Error(
      `${step.provider}: ${step.step} failed: the answer's ${key} is not a ` +
        `number of seconds`,
    );
  }
  return seconds;
}

/** Read a file through the context, failing with the provider and the path. */
export async function readAuthFile(
  context: PrometheusCredentialsContext,
  provider: string,
  what: string,
  path: string,
): Promise<string> {
  try {
    return await context.readTextFile(path);
  } catch (error) {
    throw new Error(
      `${provider}: could not read ${what} at ${path}: ${messageOf(error)}`,
    );
  }
}
