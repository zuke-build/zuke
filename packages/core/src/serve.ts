// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Serving HTTP with a fetch-style handler: one that takes a web `Request` and
 * returns a web `Response`.
 *
 * On Deno this is `Deno.serve`, as it has always been. On any other runtime it
 * is `node:http`, with Node's request and response adapted to the web ones,
 * see {@link serveOnNode}.
 *
 * Internal (not a published entrypoint).
 *
 * @module
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ON_DENO } from "./runtime.ts";

/** A handler that answers a web request with a web response. */
export type FetchHandler = (request: Request) => Response | Promise<Response>;

/** Where and for how long to serve. */
export interface ServeOptions {
  /** The address to bind. */
  hostname: string;
  /** The port to bind; `0` picks a free one. */
  port: number;
  /** Aborting it stops the server. */
  signal?: AbortSignal;
  /** Called once the server is listening, with the port it bound. */
  onListen: (address: { hostname: string; port: number }) => void;
}

/**
 * Serve `handler` until `options.signal` aborts, resolving once the server
 * has closed. A signal aborted already starts nothing: Deno would wait
 * forever on a server it never opened.
 */
export async function serve(
  options: ServeOptions,
  handler: FetchHandler,
): Promise<void> {
  if (options.signal?.aborted) return;
  if (!ON_DENO) return await serveOnNode(options, handler);
  const server = Deno.serve({
    hostname: options.hostname,
    port: options.port,
    signal: options.signal,
    onListen: options.onListen,
  }, handler);
  await server.finished;
}

/** What `Request` needs to stream a body on Node; Deno's types lack it. */
type StreamingInit = RequestInit & { duplex: "half" };

/**
 * The web request for `incoming`. Its URL is built from the `Host` header,
 * as Deno builds it, or from the bound address when that header does not
 * make a URL. The body is streamed, never buffered here, so a handler that
 * bounds what it reads bounds what the server holds.
 */
export function webRequest(incoming: IncomingMessage, bound: string): Request {
  const path = incoming.url ?? "/";
  const given = `http://${incoming.headers.host ?? ""}${path}`;
  const url = URL.canParse(given)
    ? given
    : URL.canParse(`${bound}${path}`)
    ? `${bound}${path}`
    : `${bound}/`;
  const headers = new Headers();
  const raw = incoming.rawHeaders;
  for (let at = 0; at + 1 < raw.length; at += 2) {
    headers.append(raw[at], raw[at + 1]);
  }
  const method = incoming.method ?? "GET";
  const init: StreamingInit = {
    method,
    headers,
    body: method === "GET" || method === "HEAD"
      ? null
      : Readable.toWeb(incoming),
    duplex: "half",
  };
  return new Request(url, init);
}

/**
 * Write `response` to `outgoing`. A body the client stops reading ends the
 * write quietly: the client has gone, and there is nobody to tell.
 */
export async function sendResponse(
  response: Response,
  outgoing: ServerResponse,
): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => outgoing.setHeader(name, value));
  if (response.body === null) {
    outgoing.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body), outgoing);
  } catch {
    outgoing.destroy();
  }
}

/** The answer to a request the handler threw on, as `Deno.serve` gives it. */
function internalError(): Response {
  return new Response("Internal Server Error", { status: 500 });
}

/**
 * {@link serve} on `node:http`. A handler that throws is answered `500`, as
 * on Deno. Aborting stops new connections and closes idle ones; a request in
 * flight is answered first.
 */
export async function serveOnNode(
  options: ServeOptions,
  handler: FetchHandler,
): Promise<void> {
  let bound = `http://${options.hostname}`;
  let stopping = false;
  // Each open connection, and whether it is answering a request now. Kept
  // here because not every `node:http` closes idle connections on request.
  const connections = new Map<Socket, boolean>();
  const server = createServer((incoming, outgoing) => {
    const socket = incoming.socket;
    connections.set(socket, true);
    outgoing.once("close", () => {
      if (stopping) socket.destroy();
      else connections.set(socket, false);
    });
    const answer = async (): Promise<Response> => {
      try {
        return await handler(webRequest(incoming, bound));
      } catch {
        return internalError();
      }
    };
    void answer().then((response) => sendResponse(response, outgoing));
  });
  server.on("connection", (socket) => {
    connections.set(socket, false);
    socket.once("close", () => connections.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null
    ? address.port
    : options.port;
  bound = `http://${
    options.hostname.includes(":") ? `[${options.hostname}]` : options.hostname
  }:${port}`;
  const closed = new Promise<void>((resolve) => server.once("close", resolve));
  options.signal?.addEventListener("abort", () => {
    stopping = true;
    server.close();
    for (const [socket, busy] of connections) if (!busy) socket.destroy();
  }, { once: true });
  options.onListen({ hostname: options.hostname, port });
  await closed;
}
