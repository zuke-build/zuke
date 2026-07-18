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
 * This is a **bridge, not an internet gateway**: it binds loopback by default,
 * a non-loopback bind requires a bearer token, and production deployments should
 * put real TLS/authentication in front of it.
 *
 * @module
 */

import {
  err,
  INVALID_REQUEST,
  type JsonRpcResponse,
  PARSE_ERROR,
} from "./jsonrpc.ts";

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
  /** Abort to stop the server (its {@link serveHttp} promise then resolves). */
  signal?: AbortSignal;
  /** Called once the listener is bound, with the actual address (test hook). */
  onListen?: (address: { hostname: string; port: number }) => void;
}

/** A JSON `Response` with the given status and `application/json` content type. */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Constant-time string comparison, so token validation does not leak the token
 * through response timing. The length is compared first (a length difference is
 * not itself sensitive), then every character regardless of early mismatches.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Serve JSON-RPC over HTTP: each `POST` carries one JSON-RPC message as its
 * body, `handle` produces the response, and it is returned as JSON. A
 * notification (`handle` returns `null`) is answered `202 Accepted` with no
 * body. Unparseable JSON gets a `400` JSON-RPC parse error; a non-`POST` gets
 * `405`; a bad/absent bearer token (when one is configured) gets `401`.
 *
 * Resolves when the server closes (abort {@link HttpTransportOptions.signal}).
 */
export async function serveHttp(
  handle: (message: unknown) => Promise<JsonRpcResponse | null>,
  options: HttpTransportOptions,
): Promise<void> {
  const { host, port, token, signal, onListen } = options;
  const authExpected = token !== undefined && token !== ""
    ? `Bearer ${token}`
    : undefined;

  // Process messages one at a time: the server/execute path mutates per-run
  // parameter state, so concurrent handling of two POSTs would race. Requests
  // still arrive concurrently; this chain resolves them in arrival order.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = (message: unknown): Promise<JsonRpcResponse | null> => {
    const result = queue.then(() => handle(message));
    queue = result.then(() => {}, () => {});
    return result;
  };

  const onRequest = async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return jsonResponse(
        err(null, INVALID_REQUEST, "This MCP endpoint accepts POST only."),
        405,
      );
    }
    if (authExpected !== undefined) {
      const provided = request.headers.get("authorization") ?? "";
      if (!safeEqual(provided, authExpected)) {
        return new Response(
          JSON.stringify(err(null, INVALID_REQUEST, "Unauthorized")),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
              "www-authenticate": "Bearer",
            },
          },
        );
      }
    }
    let message: unknown;
    try {
      message = JSON.parse(await request.text());
    } catch {
      return jsonResponse(err(null, PARSE_ERROR, "Parse error"), 400);
    }
    const response = await serial(message);
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
