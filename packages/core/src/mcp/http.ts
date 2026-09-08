// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A dependency-free HTTP transport for the MCP server, implementing the
 * client→server half of MCP's streamable-HTTP transport: a JSON-RPC message is
 * POSTed as a JSON body and its response returned as the JSON body of the reply.
 * Zuke never initiates server→client messages, so the optional SSE stream (a GET
 * that stays open) is not implemented — a GET is answered `405`, and clients
 * fall back to POST-only, which is spec-compliant.
 *
 * It feeds the same {@link "./server.ts".McpServer.handleMessage} the stdio
 * transport does. Messages are processed **one at a time** (see the serialising
 * chain below), because the server and {@link "../executor.ts".execute} assume
 * serial handling — a build's parameters resolve into shared state per run, so
 * two concurrent runs of one build instance would race.
 *
 * This is a **bridge, not an internet gateway**: it binds loopback by default, a
 * non-loopback bind must authenticate its callers (a bearer token or an
 * {@link "./auth.ts".McpAuthenticator}), and production deployments should put
 * real TLS in front of it.
 *
 * @module
 */

import {
  err,
  INVALID_REQUEST,
  type JsonRpcResponse,
  type McpRequestContext,
  PARSE_ERROR,
} from "./jsonrpc.ts";
import { timingSafeEqual } from "./authz.ts";
import {
  PROTOCOL_VERSION_HEADER,
  unsupportedProtocolVersion,
} from "./protocol.ts";
import {
  authenticateRequest,
  bearerChallenge,
  INVALID_TOKEN,
  isResolvedIdentity,
  type McpAuthenticator,
  type McpAuthReject,
  refusalReason,
  type ResolvedIdentity,
  UNAUTHORIZED,
  withResourceMetadata,
} from "./auth.ts";
import {
  metadataDocument,
  metadataPath,
  metadataUrl,
  type ProtectedResourceSettings,
} from "./resource_metadata.ts";
import { isLoopbackHost } from "../http.ts";

/** Options for {@link serveHttp}. */
export interface HttpTransportOptions {
  /** The hostname/address to bind (e.g. `127.0.0.1`). */
  host: string;
  /** The TCP port to bind (`0` picks a free port — used in tests). */
  port: number;
  /**
   * Bearer token required on every request (`Authorization: Bearer <token>`).
   * When set, a missing or wrong token gets `401`; when unset, requests are
   * unauthenticated (only safe on loopback — the caller enforces that).
   */
  token?: string;
  /**
   * Origins allowed to call the server. When set, a request whose `Origin`
   * header is present must exactly match one of these (a request with no
   * `Origin`, e.g. a CLI client, is always allowed). When unset, the default
   * applies: on a **loopback** bind, only loopback origins pass — the
   * DNS-rebinding / browser drive-by guard the MCP streamable-HTTP spec
   * requires; on a non-loopback bind, no default Origin check runs (front it
   * with your own TLS/authn).
   */
  allowedOrigins?: string[];
  /** Abort to stop the server (its {@link serveHttp} promise then resolves). */
  signal?: AbortSignal;
  /** Called once the listener is bound, with the actual address (test hook). */
  onListen?: (address: { hostname: string; port: number }) => void;
  /**
   * Handle requests **concurrently** instead of one at a time. Off by default:
   * the single-build server mutates per-run parameter state on the shared build
   * instance, so its handling must serialise. A handler with no shared in-process
   * state (the registry server — each run is its own subprocess, reads only hit
   * the CAS store) opts in, so a long run never head-of-line-blocks a read.
   */
  concurrent?: boolean;
  /**
   * Authenticates every request before its body is read, when the server has
   * one. A refusal becomes a real HTTP status and `WWW-Authenticate` challenge
   * here rather than a JSON-RPC error inside a `200`, which is what lets an MCP
   * client discover where to authenticate.
   */
  authenticator?: McpAuthenticator;
  /**
   * Publishes this endpoint's OAuth 2.0 Protected Resource Metadata (RFC 9728)
   * and names it in every `WWW-Authenticate` challenge, so a client that has
   * never authenticated can discover where to get a token.
   *
   * The document is served on unauthenticated `GET`s — necessarily, since a
   * caller asking where to authenticate has nothing to authenticate with — at
   * the path {@link "./resource_metadata.ts".metadataPath} derives. There is
   * deliberately no general "extra routes" hook here: this document is the only
   * thing that has to be reachable before authentication, and a seam that let
   * anything else in would be a seam whose entries are unauthenticated by
   * construction.
   */
  protectedResource?: ProtectedResourceSettings;
}

/** A JSON `Response` with the given status and `application/json` content type. */
/**
 * The largest JSON-RPC request body this transport will buffer. A single MCP
 * message is a tool call with a handful of scalar arguments, so a megabyte is
 * already generous; the cap exists so an unauthenticated (or merely buggy)
 * client cannot exhaust memory with one very large POST.
 */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Read a request body as text, or return `null` once it exceeds `limit` bytes.
 * Reads incrementally and abandons the stream at the cap, so an oversized body
 * — including a chunked one that declares no `content-length` — is never
 * buffered whole just to be rejected.
 */
async function readBounded(
  request: Request,
  limit: number,
): Promise<string | null> {
  const body = request.body;
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Extract the credential from an `Authorization: Bearer <token>` header, or
 * `undefined` when it is absent, not the Bearer scheme, or not exactly one
 * token. The scheme is matched case-insensitively (per RFC 7235) and extra
 * surrounding/inner whitespace is tolerated, so trivial client formatting
 * differences don't spuriously fail auth — but a credential is required to be a
 * single `token68` (RFC 6750), so `Bearer <token> <anything-else>` is rejected
 * rather than treated as the token. `split` on whitespace is a linear scan (no
 * backtracking), so this stays safe on adversarial input.
 */
function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return undefined;
  }
  return parts[1];
}

/**
 * The request as an authenticator sees it: same method, URL and headers, no
 * body. `undefined` when no such view can be built.
 *
 * The body belongs to the transport. A request's body can be read once, so an
 * authenticator that peeked at this one would leave nothing for the dispatcher
 * to parse — and the next read fails with a bare `TypeError`, nowhere near the
 * code that caused it. A credential never lives in the body anyway, so handing
 * over a bodiless view costs an authenticator nothing and makes that mistake
 * impossible rather than merely documented.
 *
 * The constructor can refuse: Deno builds `request.url` from the raw `Host`
 * header, and it accepts hosts the WHATWG URL parser rejects (`Host: bad host`).
 * Such a request is still a request — its headers, which is where a credential
 * lives, are intact — so the view is simply absent and the authenticator falls
 * back to them, rather than the whole exchange failing on a header the server
 * itself was willing to accept.
 */
function authenticatorView(request: Request): Request | undefined {
  try {
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
    });
  } catch {
    return undefined;
  }
}

/**
 * The response for a refused request: the refusal's status, its reason as a
 * JSON-RPC error so a client that only speaks JSON-RPC still sees one, and its
 * `WWW-Authenticate` challenge when it carries one — the header an MCP client
 * reads to discover where to authenticate.
 *
 * The status is deliberately a real HTTP status rather than a `200` carrying a
 * JSON-RPC error. A challenge is only meaningful on a `401`, so a refusal
 * wrapped in a `200` cannot tell a client where to authenticate — which is the
 * whole point of an authenticator that can be discovered rather than
 * pre-configured. This is not a new status class for this transport either: a
 * bad or absent bearer token has always been answered `401` here, a non-`POST`
 * `405`, and unparseable JSON `400`, so a client that reads any non-`200` as a
 * transport failure was already broken against a token-protected server. The
 * body still carries the JSON-RPC error. One reason did change: a bearer token
 * that was presented and rejected now reads `invalid_token` rather than the
 * generic `Unauthorized`, which is what OAuth defines it as and what tells a
 * client its stored credential — rather than its absence — is the problem.
 */
function refusedResponse(
  reject: McpAuthReject,
  discovery?: { metadataUrl: string; scopes: readonly string[] },
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (reject.challenge !== undefined) {
    headers.set("www-authenticate", challengeFor(reject, discovery));
  }
  return new Response(
    JSON.stringify(err(null, INVALID_REQUEST, refusalReason(reject))),
    { status: reject.status, headers },
  );
}

/**
 * The challenge to send with `reject`.
 *
 * Zuke's own two refusals are **rebuilt** rather than patched, so the declared
 * scopes go in as a proper `scope` parameter — the specification asks a
 * protected resource to name what the operation needs, and a client with no
 * challenge scope falls back to requesting the entire advertised catalogue. An
 * authenticator's own challenge is a string this code did not write and cannot
 * safely re-derive, so that one is only given the metadata URL it lacks.
 */
function challengeFor(
  reject: McpAuthReject,
  discovery?: { metadataUrl: string; scopes: readonly string[] },
): string {
  const challenge = reject.challenge ?? "Bearer";
  if (discovery === undefined) return challenge;
  const ours = reject === UNAUTHORIZED || reject === INVALID_TOKEN;
  if (!ours) return withResourceMetadata(challenge, discovery.metadataUrl);
  return bearerChallenge({
    metadataUrl: discovery.metadataUrl,
    scopes: discovery.scopes,
    // Only a token that was presented and rejected names an error; a request
    // that carried no credentials has had nothing of its own refused yet.
    ...(reject === INVALID_TOKEN ? { error: "invalid_token" as const } : {}),
  });
}

/**
 * The metadata document as a public, cacheable, cross-origin-readable
 * response.
 *
 * No `Origin` check runs on this one. The document is public by definition —
 * it names authorization servers and scopes, and carries nothing a caller could
 * not learn by attempting to authenticate — and browser-based MCP clients fetch
 * it cross-origin, so gating it on `Origin` would break them while protecting
 * nothing.
 */
function metadataResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=3600",
    },
  });
}

/** The hostname of an `Origin` value, or `null` if it can't be parsed. */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/**
 * Whether a request's `Origin` is allowed. A client that sends no `Origin` (a
 * CLI/MCP client, not a browser) is always allowed. With an explicit
 * {@link HttpTransportOptions.allowedOrigins} list the origin must be in it.
 * Otherwise, on a loopback bind only loopback origins pass (the drive-by /
 * DNS-rebinding guard); a non-loopback bind runs no default check.
 */
export function originAllowed(
  origin: string | null,
  allowed: string[] | undefined,
  bindHost: string,
): boolean {
  if (origin === null) return true;
  if (allowed !== undefined) return allowed.includes(origin);
  if (!isLoopbackHost(bindHost)) return true;
  const host = originHost(origin);
  return host !== null && isLoopbackHost(host);
}

/**
 * Serve JSON-RPC over HTTP: each `POST` carries one JSON-RPC message as its
 * body, `handle` produces the response, and it is returned as JSON. A
 * notification (`handle` returns `null`) is answered `202 Accepted` with no
 * body. Unparseable JSON gets a `400` JSON-RPC parse error; a non-`POST` gets
 * `405`; a bad/absent bearer token (when one is configured) gets `401`; an
 * authenticator's refusal gets that refusal's own status and challenge.
 *
 * Resolves when the server closes (abort {@link HttpTransportOptions.signal}).
 */
export async function serveHttp(
  handle: (
    message: unknown,
    ctx: McpRequestContext,
    identity?: ResolvedIdentity,
  ) => Promise<JsonRpcResponse | null>,
  options: HttpTransportOptions,
): Promise<void> {
  const {
    host,
    port,
    token,
    signal,
    onListen,
    concurrent,
    allowedOrigins,
    authenticator,
    protectedResource,
  } = options;

  // By default, process messages one at a time: the single-build server/execute
  // path mutates per-run parameter state, so concurrent handling of two POSTs
  // would race. Requests still arrive concurrently; this chain resolves them in
  // arrival order. A `concurrent` handler bypasses the queue entirely.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = (
    message: unknown,
    ctx: McpRequestContext,
    identity?: ResolvedIdentity,
  ): Promise<JsonRpcResponse | null> => {
    const result = queue.then(() => handle(message, ctx, identity));
    queue = result.then(() => {}, () => {});
    return result;
  };
  const dispatch = concurrent === true ? handle : serial;

  const metadataAt = protectedResource === undefined
    ? undefined
    : metadataPath(protectedResource.resource_);
  const discovery = protectedResource === undefined ? undefined : {
    metadataUrl: metadataUrl(protectedResource.resource_),
    scopes: protectedResource.scopes_,
  };
  // Rendered once, here, rather than per request. Building it in the handler
  // would put a throw on an unauthenticated public path — a declaration mutated
  // after startup, say — where it becomes a 500 with no error boundary. It is
  // also a constant, so re-serialising it for every caller was pure waste.
  const metadataBody = protectedResource === undefined
    ? undefined
    : JSON.stringify(metadataDocument(protectedResource), null, 2);

  const onRequest = async (request: Request): Promise<Response> => {
    // Before every other check, including the method one: this is the document
    // an unauthenticated client reads to find out where to authenticate, and it
    // is fetched with GET.
    if (metadataBody !== undefined) {
      // Guarded, because Deno builds `request.url` from the raw `Host` header
      // and accepts hosts the WHATWG parser rejects (`Host: bad host`). This
      // runs before every other check, so an unguarded throw here would answer
      // *every* request — authenticated ones included — with a 500. That is the
      // same trap `authenticatorView` below already documents; it is one call
      // earlier, and it must be caught the same way.
      let path: string;
      try {
        path = new URL(request.url).pathname;
      } catch {
        path = "";
      }
      if (path === metadataAt) {
        if (request.method === "GET" || request.method === "HEAD") {
          return metadataResponse(metadataBody);
        }
        if (request.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "GET, HEAD, OPTIONS",
              "access-control-allow-headers": "authorization, content-type",
            },
          });
        }
      }
    }
    if (request.method !== "POST") {
      return jsonResponse(
        err(null, INVALID_REQUEST, "This MCP endpoint accepts POST only."),
        405,
      );
    }
    // Reject a cross-origin browser request before doing anything else: on a
    // loopback bind this blocks a drive-by / DNS-rebinding page from driving the
    // local server. A CLI client sends no Origin and passes. (This is the guard;
    // a Content-Type check is deliberately not added — Deno/browser `fetch`
    // defaults a string body to text/plain, so requiring JSON would break
    // legitimate non-SDK clients, and Origin already stops the cross-origin case.)
    if (!originAllowed(request.headers.get("origin"), allowedOrigins, host)) {
      return jsonResponse(
        err(null, INVALID_REQUEST, "Forbidden: Origin not allowed."),
        403,
      );
    }
    if (token !== undefined && token !== "") {
      const provided = bearerToken(request.headers.get("authorization"));
      if (provided === undefined || !timingSafeEqual(provided, token)) {
        // A caller that sent nothing is told only that it must authenticate; a
        // caller whose token was rejected is told that much and no more.
        return refusedResponse(
          provided === undefined ? UNAUTHORIZED : INVALID_TOKEN,
          discovery,
        );
      }
    }
    // Authenticate before reading the body: an unauthenticated caller never gets
    // to make the server buffer a megabyte for it.
    const ctx: McpRequestContext = {
      headers: request.headers,
      request: authenticatorView(request),
    };
    let identity: ResolvedIdentity | undefined;
    if (authenticator !== undefined) {
      const resolved = await authenticateRequest(authenticator, ctx);
      if (!isResolvedIdentity(resolved)) {
        return refusedResponse(resolved, discovery);
      }
      identity = resolved;
    }
    // Placed after authentication on purpose. A version this server never
    // agreed to must be refused — the header exists so a client cannot proceed
    // on a revision the server does not implement, and the specification makes
    // the `400` a MUST — but the refusal names every revision this build
    // supports, and an unauthenticated caller has no business enumerating them.
    // The specification does not order this against the `401`, and the check
    // is an O(1) compare that still precedes reading the body. An absent header
    // is left alone: it is the ordinary case before a client has initialized,
    // and nothing here behaves differently across the supported revisions.
    const badVersion = unsupportedProtocolVersion(
      request.headers.get(PROTOCOL_VERSION_HEADER),
    );
    if (badVersion !== undefined) {
      return jsonResponse(err(null, INVALID_REQUEST, badVersion), 400);
    }
    const body = await readBounded(request, MAX_BODY_BYTES);
    if (body === null) {
      return jsonResponse(
        err(null, INVALID_REQUEST, "Request body too large"),
        413,
      );
    }
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      return jsonResponse(err(null, PARSE_ERROR, "Parse error"), 400);
    }
    const response = await dispatch(message, ctx, identity);
    if (response === null) return new Response(null, { status: 202 });
    return jsonResponse(response, 200);
  };

  const server = Deno.serve({
    hostname: host,
    port,
    signal,
    // Suppress Deno's default "Listening on …" line; the command prints its own
    // banner. Tests use this to learn the port bound for `port: 0`.
    onListen: onListen ?? (() => {}),
  }, onRequest);
  await server.finished;
}
