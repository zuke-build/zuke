// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Authentication, in one place: the {@link PrometheusCredentials} interface
 * every credential source implements, the built-in sources — bearer token,
 * basic auth, a static header — and {@link authorize}, which runs them in
 * order over the outgoing request.
 *
 * A source sees the **whole** request — method, full URL with its query,
 * the headers set so far, and the exact body bytes — and returns the headers
 * to add. That is the shape a request signer needs (AWS SigV4 signs the
 * method, canonical URI and query, the signed headers, and the body's SHA-256)
 * as well as a token source (an OAuth client that caches its access token
 * until expiry), so a new kind of credential is a new function, not a change
 * to the transport.
 *
 * Every header value a source returns is registered with the call's redactor
 * before the request is sent, so it is masked in any error the call raises.
 *
 * @module
 */

import type { Redactor } from "@zuke/core";
import type { PrometheusHttpMethod } from "./types.ts";

/** Header names to values, as a credential source returns them. */
export type PrometheusHeaders = Readonly<Record<string, string>>;

/**
 * The outgoing request a {@link PrometheusCredentials} source authenticates —
 * exactly what will be sent, so a signature computed over it verifies.
 */
export interface PrometheusOutgoingRequest {
  /** The HTTP method: `GET`, or `POST` for a form-encoded call. */
  readonly method: PrometheusHttpMethod;
  /**
   * The absolute URL, including the query string: the base URL's own path and
   * parameters, the endpoint path, and — on a `GET` — the call's parameters,
   * percent-encoded as sent.
   */
  readonly url: string;
  /**
   * The headers set so far, with lower-case names: the transport's own
   * (`accept`, and `content-type` on a `POST`) plus whatever the sources
   * configured before this one added. A source may only add headers — naming
   * one already present fails the call — so a signer configured last signs
   * every header that is sent.
   */
  readonly headers: PrometheusHeaders;
  /**
   * The exact body bytes — the `application/x-www-form-urlencoded` form on a
   * `POST`, empty on a `GET`. A copy: changing it changes nothing that is sent.
   */
  readonly body: Uint8Array;
}

/**
 * The seams a credential source reads the outside world through, so a source
 * that reads an environment variable, a key file, the clock or a token
 * endpoint is testable without any of them. Each is set on the connection
 * settings (`readEnv`, `readTextFile`, `now`, `fetch`).
 */
export interface PrometheusCredentialsContext {
  /** Read an environment variable; `undefined` when unset or not permitted. */
  readonly readEnv: (name: string) => string | undefined;
  /** Read a text file — a mounted token, a key, a credentials file. */
  readonly readTextFile: (path: string) => Promise<string>;
  /** The current time in epoch milliseconds, for signing and token expiry. */
  readonly now: () => number;
  /** The `fetch` the call itself uses, for a source that exchanges tokens. */
  readonly fetch: typeof fetch;
  /** Aborts when the call times out or the caller's signal fires. */
  readonly signal: AbortSignal;
}

/**
 * A credential source: given the outgoing request and the context's seams,
 * return the headers that authenticate it.
 *
 * Sources run in the order they were configured, each seeing the headers the
 * earlier ones added, and may not replace a header that is already present.
 * Every returned value is treated as a secret and masked in errors (values
 * shorter than eight characters excepted — see {@link registerSecrets}). A
 * source that throws fails the call with a
 * {@link "./errors.ts".PrometheusRequestError} whose message is scrubbed the
 * same way. It is called once per request.
 *
 * A source that caches — a token until its expiry — must keep that cache
 * outside the settings lambda: the lambda runs on every call, so a source
 * created inside it starts empty each time. Define the source once at module
 * level (or key its cache in module state, as the built-in `google`, `azure`
 * and `sigv4` sources do) and pass that one function to `credentials(...)`.
 */
export type PrometheusCredentials = (
  request: PrometheusOutgoingRequest,
  context: PrometheusCredentialsContext,
) => PrometheusHeaders | Promise<PrometheusHeaders>;

/**
 * The shortest value worth masking. A two-character header value — a tenant id
 * of `"1"` — masked everywhere would turn `HTTP 401` into `HTTP 40[redacted]`,
 * and a credential that short is no credential.
 */
const MIN_SECRET_LENGTH = 8;

/**
 * Register a header value with the call's redactor: the whole value, and the
 * part after an auth scheme (`Bearer <token>`, `Basic <base64>`), since a
 * server that echoes a credential back echoes the token, not the header.
 */
export function registerSecrets(redactor: Redactor, value: string): void {
  const scheme = /^\S+\s+(\S.*)$/.exec(value);
  for (const secret of [value, scheme === null ? "" : scheme[1]]) {
    if (secret.length >= MIN_SECRET_LENGTH) redactor.add(secret);
  }
}

/**
 * Sources that add a plain header — a tenant id, a content negotiation
 * header — rather than a credential. They do not make a call credentialed for
 * the plaintext rule. Kept here, beside the constructors that mark them, so
 * the mark cannot be set from outside the package.
 */
const plainSources = new WeakSet<PrometheusCredentials>();

/**
 * Secrets a source carries beyond the header values it returns — basic
 * auth's password, which a server echoes back decoded, not base64-encoded.
 */
const extraSecrets = new WeakMap<PrometheusCredentials, readonly string[]>();

/**
 * Header names whose value is a credential however it is configured: the
 * `Authorization` and `Proxy-Authorization` schemes, and a session cookie.
 */
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
]);

/** A source that adds one fixed header, as a credential. */
export function headerCredentials(
  name: string,
  value: string,
): PrometheusCredentials {
  return () => ({ [name]: value });
}

/**
 * A source that adds one fixed header set by `header(...)`: a credential when
 * its name is `Authorization`, `Proxy-Authorization` or `Cookie`, a plain
 * header otherwise. Its value is masked in errors either way.
 */
export function plainHeader(
  name: string,
  value: string,
): PrometheusCredentials {
  const source = headerCredentials(name, value);
  if (!CREDENTIAL_HEADERS.has(name.toLowerCase())) plainSources.add(source);
  return source;
}

/** Whether `source` carries a credential, for the plaintext rule. */
export function isCredential(source: PrometheusCredentials): boolean {
  return !plainSources.has(source);
}

/** `Authorization: Bearer <token>`. */
export function bearerCredentials(token: string): PrometheusCredentials {
  if (token === "") {
    throw new Error(
      "bearerToken(...) was given an empty token — a missing secret, most " +
        "likely. Pass the token, or leave bearerToken out.",
    );
  }
  return headerCredentials("authorization", `Bearer ${token}`);
}

/** `Authorization: Basic <base64(username:password)>`, UTF-8 encoded. */
export function basicCredentials(
  username: string,
  password: string,
): PrometheusCredentials {
  if (username.includes(":")) {
    throw new Error(
      "basicAuth(...) was given a username containing ':', which basic " +
        "authentication cannot carry (RFC 7617).",
    );
  }
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  const encoded = btoa(String.fromCharCode(...bytes));
  const source = headerCredentials("authorization", `Basic ${encoded}`);
  extraSecrets.set(source, [password]);
  return source;
}

/**
 * Run `sources` in order over the request, returning the full header set to
 * send. Each source's values are registered with `redactor` the moment they
 * are returned, so even a later source's failure is reported without them.
 */
export async function authorize(
  sources: readonly PrometheusCredentials[],
  request: PrometheusOutgoingRequest,
  context: PrometheusCredentialsContext,
  redactor: Redactor,
): Promise<Map<string, string>> {
  // A Map, not an object: a header a source names `__proto__` must stay a
  // header, not become an assignment to the object's prototype.
  const headers = new Map(Object.entries(request.headers));
  for (const source of sources) {
    for (const secret of extraSecrets.get(source) ?? []) {
      registerSecrets(redactor, secret);
    }
    const added = await source(
      {
        ...request,
        headers: Object.fromEntries(headers),
        body: request.body.slice(),
      },
      context,
    );
    for (const [name, value] of Object.entries(added)) {
      registerSecrets(redactor, value);
      const key = name.toLowerCase();
      // Checked here rather than left to `Headers`, whose own error quotes the
      // offending value — which is the credential.
      if (/[\r\n\0]/.test(value)) {
        throw new Error(
          `the ${key} header's value contains a line break or NUL — a token ` +
            `read from a file usually needs .trim()`,
        );
      }
      if (headers.has(key)) {
        throw new Error(
          `the ${key} header is already set — by the request itself ` +
            `(accept, content-type) or by an earlier header or credential ` +
            `setter; set each header once`,
        );
      }
      headers.set(key, value);
    }
  }
  return headers;
}
