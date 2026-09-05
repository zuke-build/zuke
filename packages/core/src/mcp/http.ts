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
  authenticateRequest,
  isResolvedIdentity,
  type McpAuthenticator,
  type McpAuthReject,
  refusalReason,
  type ResolvedIdentity,
  UNAUTHORIZED,
} from "./auth.ts";
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
 */
function refusedResponse(reject: McpAuthReject): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (reject.challenge !== undefined) {
    headers.set("www-authenticate", reject.challenge);
  }
  return new Response(
    JSON.stringify(err(null, INVALID_REQUEST, refusalReason(reject))),
    { status: reject.status, headers },
  );
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

  const onRequest = async (request: Request): Promise<Response> => {
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
        return refusedResponse(UNAUTHORIZED);
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
      if (!isResolvedIdentity(resolved)) return refusedResponse(resolved);
      identity = resolved;
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
