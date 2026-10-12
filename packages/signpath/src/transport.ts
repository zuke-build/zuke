// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one transport every SignPath call uses: send under a timeout, retry
 * what is safe to retry, never follow a redirect blindly, read the answer up
 * to a cap, and turn a refusal into a scrubbed {@link SignPathApiError}.
 *
 * One copy, for the reason `@zuke/gh` and `@zuke/prometheus` keep one: a guard
 * that lives in the transport is applied to every endpoint, and a guard that
 * lives anywhere else is one endpoint short.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { readBytesBounded } from "@zuke/core";
import type { Connection } from "./connect.ts";
import { SignPathApiError, SignPathRequestError } from "./errors.ts";
import { scrub } from "./scrub.ts";
import { isRecord, optionalString, parseJson } from "./shape.ts";

/** The largest JSON answer read: 1 MiB is far more than any SignPath answer. */
const MAX_ANSWER_BYTES = 1024 * 1024;

/** The first retry's delay; each later one doubles, up to {@link MAX_RETRY_DELAY_MS}. */
const FIRST_RETRY_DELAY_MS = 1_000;

/** The longest delay between two attempts. */
const MAX_RETRY_DELAY_MS = 30_000;

/** The statuses that say a call did nothing and may be repeated as it was. */
const NOT_PROCESSED = [429, 503];

/** The statuses worth retrying for a call that is safe to repeat. */
const TRANSIENT = [429, 502, 503, 504];

/** One request, as the transport sends it. */
export interface Outgoing {
  /** `GET` to read, `POST` to submit. */
  readonly method: "GET" | "POST";
  /** Where it goes. */
  readonly url: URL;
  /** The API path errors name the call by (no host, no secret). */
  readonly path: string;
  /** The body: a multipart form or a JSON text. */
  readonly body?: FormData | string;
  /** Whether to send the API token; off for a hop to another origin. */
  readonly authorize: boolean;
  /** The timeout for the whole exchange, body included, in ms. */
  readonly timeoutMs: number;
}

/** A response and the timeout signal still governing its body. */
export interface Exchange {
  /** The response, its body unread. */
  readonly response: Response;
  /** Aborts when the call's timeout elapses; reading the body honours it. */
  readonly signal: AbortSignal;
}

/** An answer read to its end. */
export interface Answer {
  /** The HTTP status. */
  readonly status: number;
  /** Whether the status is 2xx. */
  readonly ok: boolean;
  /** The body, decoded as UTF-8. */
  readonly text: string;
  /** The response headers. */
  readonly headers: Headers;
}

/**
 * Whether `response` is a redirect. Deno's `redirect: "manual"` hands back the
 * 3xx itself, `Location` header and all, rather than a browser's opaque one.
 */
export function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

/** Whether a POST may be repeated: only when the answer says it did nothing. */
function retryable(outgoing: Outgoing, status: number): boolean {
  return (outgoing.method === "GET" ? TRANSIENT : NOT_PROCESSED).includes(
    status,
  );
}

/** The delay before retry number `attempt` (0-based). */
function backoff(attempt: number): number {
  return Math.min(FIRST_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

/**
 * Send `outgoing`, retrying a transient failure up to the connection's retry
 * count. A redirect is returned, not followed — the caller decides. Throws a
 * scrubbed {@link SignPathRequestError} when no answer arrives.
 */
export async function send(
  connection: Connection,
  outgoing: Outgoing,
): Promise<Exchange> {
  const { settings } = connection;
  for (let attempt = 0;; attempt++) {
    const signal = AbortSignal.timeout(outgoing.timeoutMs);
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "zuke-signpath",
    };
    if (outgoing.authorize) {
      headers.authorization = `Bearer ${connection.token}`;
    }
    if (typeof outgoing.body === "string") {
      headers["content-type"] = "application/json";
    }
    let response: Response;
    try {
      response = await settings.fetch_(outgoing.url.href, {
        method: outgoing.method,
        headers,
        ...(outgoing.body === undefined ? {} : { body: outgoing.body }),
        signal,
        redirect: "manual",
      });
    } catch (error) {
      // A network error after a POST was sent may have reached SignPath, so
      // only a read is repeated.
      if (outgoing.method === "GET" && attempt < settings.retries_) {
        await settings.sleep_(backoff(attempt));
        continue;
      }
      throw failure(connection, outgoing, error, signal);
    }
    if (retryable(outgoing, response.status) && attempt < settings.retries_) {
      await response.body?.cancel();
      await settings.sleep_(backoff(attempt));
      continue;
    }
    return { response, signal };
  }
}

/** The {@link SignPathRequestError} for a call that got no answer. */
export function failure(
  connection: Connection,
  outgoing: Outgoing,
  error: unknown,
  signal: AbortSignal,
): SignPathRequestError {
  const reason = signal.aborted
    ? `timed out after ${outgoing.timeoutMs} ms`
    : scrub(
      connection.redactor,
      error instanceof Error ? error.message : String(error),
    );
  return new SignPathRequestError(outgoing.method, outgoing.path, reason);
}

/**
 * Read an exchange's whole answer through core's bounded reader, under the
 * call's timeout.
 */
export async function read(
  connection: Connection,
  outgoing: Outgoing,
  exchange: Exchange,
): Promise<Answer> {
  let bytes: Uint8Array | null;
  try {
    bytes = await readBytesBounded(exchange.response.body, MAX_ANSWER_BYTES);
  } catch (error) {
    throw failure(connection, outgoing, error, exchange.signal);
  }
  if (bytes === null) {
    throw new SignPathRequestError(
      outgoing.method,
      outgoing.path,
      `the answer is larger than ${MAX_ANSWER_BYTES} bytes`,
    );
  }
  return {
    status: exchange.response.status,
    ok: exchange.response.ok,
    text: new TextDecoder().decode(bytes),
    headers: exchange.response.headers,
  };
}

/**
 * Send `outgoing` and read its whole answer, refusing a redirect: an API call
 * carrying the token must not be steered to another host.
 */
export async function call(
  connection: Connection,
  outgoing: Outgoing,
): Promise<Answer> {
  const exchange = await send(connection, outgoing);
  if (isRedirect(exchange.response)) {
    await exchange.response.body?.cancel();
    throw new SignPathRequestError(
      outgoing.method,
      outgoing.path,
      `SignPath answered with a redirect (HTTP ${exchange.response.status}), ` +
        `which is not followed for an API call — check the API URL.`,
    );
  }
  return await read(connection, outgoing, exchange);
}

/**
 * The {@link SignPathApiError} for a refusal: the `error`, `detail`, `title`
 * or `message` of a JSON answer, else the start of the text — scrubbed.
 */
export function refusal(
  connection: Connection,
  outgoing: Outgoing,
  answer: Answer,
): SignPathApiError {
  const json = parseJson(answer.text);
  const said = isRecord(json)
    ? optionalString(json, "error") ?? optionalString(json, "detail") ??
      optionalString(json, "title") ?? optionalString(json, "message")
    : answer.text;
  const detail = said === undefined ? "" : scrub(connection.redactor, said);
  return new SignPathApiError(
    outgoing.method,
    outgoing.path,
    answer.status,
    detail === "" ? undefined : detail,
  );
}
