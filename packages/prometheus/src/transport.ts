// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one transport every `PrometheusTasks` method uses: resolve the
 * connection, build the request, authenticate it, send it under a timeout,
 * read the answer up to a cap, and turn the envelope into data or a typed
 * error — with every message scrubbed of credentials on the way out.
 *
 * One copy, for the reason `@zuke/gh` keeps one: a guard that lives in the
 * transport is applied to every endpoint, and a guard that lives anywhere
 * else is one endpoint short.
 *
 * @module
 */

import {
  assertSecureBackendUrl,
  readBytesBounded,
  Redactor,
  redactUrl,
  redactUrls,
} from "@zuke/core";
import type { PrometheusConnectionSettings } from "./connection.ts";
import {
  authorize,
  basicCredentials,
  type PrometheusCredentials,
  type PrometheusCredentialsContext,
} from "./credentials.ts";
import { PrometheusApiError, PrometheusRequestError } from "./errors.ts";
import { isRecord, own, readStringArray } from "./shape.ts";
import type { PrometheusHttpMethod, PrometheusResponse } from "./types.ts";

/** One call: the method, the endpoint path, and its parameters in order. */
export interface PrometheusCall {
  /** `GET`, or `POST` to send the parameters as a form body. */
  readonly method: PrometheusHttpMethod;
  /** The endpoint path, such as `/api/v1/query`, already encoded. */
  readonly path: string;
  /** The parameters, repeated names (`match[]`) as repeated entries. */
  readonly params: ReadonlyArray<readonly [string, string]>;
}

/** The resolved connection a call is sent over. */
interface Connection {
  /** The base URL, with any userinfo already moved into `credentials`. */
  readonly base: URL;
  /** The credential sources, userinfo's basic auth first. */
  readonly credentials: readonly PrometheusCredentials[];
  /** The client-side timeout in ms. */
  readonly timeoutMs: number;
  /** The response size cap in bytes. */
  readonly maxBytes: number;
  /** The caller's own signal, if any. */
  readonly signal: AbortSignal | undefined;
  /** The `fetch` to send with. */
  readonly fetch: typeof fetch;
  /** The seams handed to credential sources, minus the per-call signal. */
  readonly seams: Omit<PrometheusCredentialsContext, "signal">;
}

/** The longest server-supplied text an error message carries. */
const MAX_DETAIL = 500;

/** The text of an answer, and the status it came with. */
interface Answer {
  /** The HTTP status. */
  readonly status: number;
  /** Whether the status is 2xx. */
  readonly ok: boolean;
  /** The body, decoded as UTF-8. */
  readonly text: string;
}

/**
 * Validate the settings into a {@link Connection}: a URL is required, must
 * parse, must be `http:` or `https:`, and must pass core's plaintext guard.
 */
function connect(settings: PrometheusConnectionSettings): Connection {
  const raw = settings.url_;
  if (raw === undefined) {
    throw new Error(
      "a Prometheus call needs the server's address — call s.url(...).",
    );
  }
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new Error(`the Prometheus URL is not a valid URL: ${redactUrl(raw)}`);
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new Error(
      `the Prometheus URL must be http(s): ${
        redactUrl(raw)
      } is ${base.protocol}`,
    );
  }
  assertSecureBackendUrl(raw, "the Prometheus URL", settings.readEnv_);
  const credentials: PrometheusCredentials[] = [];
  if (base.username !== "" || base.password !== "") {
    credentials.push(
      basicCredentials(
        decodeURIComponent(base.username),
        decodeURIComponent(base.password),
      ),
    );
    base.username = "";
    base.password = "";
  }
  base.hash = "";
  return {
    base,
    credentials: [...credentials, ...settings.credentials_],
    timeoutMs: settings.requestTimeout_,
    maxBytes: settings.maxResponseBytes_,
    signal: settings.signal_,
    fetch: settings.fetch_,
    seams: {
      readEnv: settings.readEnv_,
      readTextFile: settings.readTextFile_,
      now: settings.now_,
      fetch: settings.fetch_,
    },
  };
}

/** The URL a call goes to: the base's path with the endpoint appended. */
function endpointUrl(base: URL, call: PrometheusCall): URL {
  const url = new URL(base.href);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${call.path}`;
  if (call.method === "GET") {
    for (const [name, value] of call.params) {
      url.searchParams.append(name, value);
    }
  }
  return url;
}

/** `text` scrubbed of registered secrets and URL credentials, then capped. */
function scrub(redactor: Redactor, text: string): string {
  // Scrub first, cap second: capping first could cut a secret in half and
  // leave its prefix where no pattern matches it any more.
  const clean = redactUrls(redactor.redact(text)).replace(/\s+/g, " ").trim();
  return clean.length > MAX_DETAIL ? `${clean.slice(0, MAX_DETAIL)}…` : clean;
}

/**
 * Send `call` and read its answer. Throws a scrubbed
 * {@link PrometheusRequestError} when no answer can be read, and rethrows the
 * caller's own abort reason untouched — a cancellation is not a failure of
 * the call.
 */
async function send(
  connection: Connection,
  call: PrometheusCall,
  redactor: Redactor,
): Promise<Answer> {
  const timeout = AbortSignal.timeout(connection.timeoutMs);
  const signal = connection.signal === undefined
    ? timeout
    : AbortSignal.any([timeout, connection.signal]);
  const url = endpointUrl(connection.base, call);
  const form = new URLSearchParams(call.params.map(([k, v]) => [k, v]));
  const body = call.method === "POST"
    ? new TextEncoder().encode(form.toString())
    : new Uint8Array(0);
  const baseHeaders: Record<string, string> = call.method === "POST"
    ? {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    }
    : { accept: "application/json" };
  try {
    const headers = await authorize(
      connection.credentials,
      { method: call.method, url: url.href, headers: baseHeaders, body },
      { ...connection.seams, signal },
      redactor,
    );
    const response = await connection.fetch(url.href, {
      method: call.method,
      headers: new Headers([...headers]),
      ...(call.method === "POST" ? { body } : {}),
      signal,
      // A redirect is not followed: it could lead to a plaintext URL the
      // https guard never saw, with the credential attached.
      redirect: "manual",
    });
    const bytes = await readBytesBounded(response.body, connection.maxBytes);
    if (bytes === null) {
      throw new PrometheusRequestError(
        call.method,
        call.path,
        response.status,
        `the answer is larger than ${connection.maxBytes} bytes ` +
          `(raise maxResponseBytes, or narrow the query)`,
      );
    }
    return {
      status: response.status,
      ok: response.ok,
      text: new TextDecoder().decode(bytes),
    };
  } catch (error) {
    if (error instanceof PrometheusRequestError) throw error;
    if (connection.signal?.aborted === true) throw connection.signal.reason;
    const reason = timeout.aborted
      ? `timed out after ${connection.timeoutMs} ms`
      : scrub(redactor, String(error));
    throw new PrometheusRequestError(call.method, call.path, undefined, reason);
  }
}

/** `text` parsed as JSON, or `undefined` when it is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The envelope's `error`/`errorType` text, scrubbed, when it is a string. */
function envelopeText(
  redactor: Redactor,
  envelope: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = own(envelope, key);
  return typeof value === "string" && value !== ""
    ? scrub(redactor, value)
    : undefined;
}

/**
 * Call a JSON API endpoint and parse its `data` with `parse`, returning the
 * typed data with the envelope's warnings and infos.
 */
export async function callApi<T>(
  settings: PrometheusConnectionSettings,
  call: PrometheusCall,
  parse: (data: unknown) => T,
): Promise<PrometheusResponse<T>> {
  const redactor = new Redactor();
  const answer = await send(connect(settings), call, redactor);
  const fail = (reason: string) =>
    new PrometheusRequestError(call.method, call.path, answer.status, reason);
  const json = parseJson(answer.text);
  if (!isRecord(json)) {
    const excerpt = scrub(redactor, answer.text);
    if (!answer.ok) {
      throw new PrometheusApiError(
        call.method,
        call.path,
        answer.status,
        undefined,
        excerpt === "" ? undefined : excerpt,
      );
    }
    throw fail(
      `HTTP ${answer.status} with an answer that is not a Prometheus ` +
        `envelope${excerpt === "" ? "" : `: ${excerpt}`}`,
    );
  }
  const status = own(json, "status");
  if (!answer.ok || status === "error") {
    throw new PrometheusApiError(
      call.method,
      call.path,
      answer.status,
      envelopeText(redactor, json, "errorType"),
      envelopeText(redactor, json, "error"),
    );
  }
  if (status !== "success") {
    throw fail(`the answer has no "status" of "success" or "error"`);
  }
  try {
    const warnings = own(json, "warnings");
    const infos = own(json, "infos");
    return {
      data: parse(own(json, "data")),
      warnings: warnings === undefined
        ? []
        : readStringArray(warnings, "warnings"),
      infos: infos === undefined ? [] : readStringArray(infos, "infos"),
    };
  } catch (error) {
    throw fail(`unexpected answer: ${scrub(redactor, String(error))}`);
  }
}

/**
 * Call a management probe (`/-/healthy`, `/-/ready`): `true` on 2xx, `false`
 * on 503 — the documented "not ready" — and a {@link PrometheusApiError} on
 * anything else, so a 401 from a misconfigured credential is not read as
 * "unhealthy".
 */
export async function callProbe(
  settings: PrometheusConnectionSettings,
  path: string,
): Promise<boolean> {
  const call: PrometheusCall = { method: "GET", path, params: [] };
  const redactor = new Redactor();
  const answer = await send(connect(settings), call, redactor);
  if (answer.ok) return true;
  if (answer.status === 503) return false;
  const excerpt = scrub(redactor, answer.text);
  throw new PrometheusApiError(
    call.method,
    call.path,
    answer.status,
    undefined,
    excerpt === "" ? undefined : excerpt,
  );
}
