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

import { createServer, type IncomingMessage } from "node:http";
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
 *
 * @throws what `options.onListen` throws, once the server it was told about
 * has closed again. Left to themselves both runtimes would pass the error
 * on and keep serving.
 */
export async function serve(
  options: ServeOptions,
  handler: FetchHandler,
): Promise<void> {
  if (options.signal?.aborted) return;
  if (!ON_DENO) return await serveOnNode(options, handler);
  let failure: { error: unknown } | undefined;
  const server = Deno.serve({
    hostname: options.hostname,
    port: options.port,
    signal: options.signal,
    onListen: (address) => {
      try {
        options.onListen(address);
      } catch (error) {
        failure = { error };
      }
    },
  }, handler);
  if (failure !== undefined) {
    await server.shutdown();
    throw failure.error;
  }
  await server.finished;
}

/** What `Request` needs to stream a body on Node; Deno's types lack it. */
type StreamingInit = RequestInit & { duplex: "half" };

/**
 * `incoming`'s body as a web stream, read only as fast as it is consumed.
 *
 * Cancelling it, as a handler does when a body is over its limit, stops
 * handing the body on, lets the rest of it flow away unread, and calls
 * `stopped`. The connection is left to the caller, so the answer to the
 * request can still be written before it goes. Left to Node's own
 * conversion, a cancel destroys the connection on some platforms and leaves
 * it reading on others.
 */
export function bodyStream(
  incoming: Readable,
  stopped: () => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      incoming.on("data", (chunk: Uint8Array) => {
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 0) <= 0) incoming.pause();
      });
      incoming.once("end", () => controller.close());
      incoming.once("error", (error) => controller.error(error));
      incoming.pause();
    },
    pull() {
      incoming.resume();
    },
    cancel() {
      incoming.removeAllListeners("data");
      incoming.resume();
      stopped();
    },
  }, { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength });
}

/**
 * The web request for `incoming`. Its URL is built from the `Host` header,
 * as Deno builds it, or from the bound address when that header does not
 * make a URL. The body is streamed, never buffered here, so a handler that
 * bounds what it reads bounds what the server holds; if the handler stops
 * reading it, `stopped` is called.
 */
export function webRequest(
  incoming: IncomingMessage,
  bound: string,
  stopped: () => void = () => {},
): Request {
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
      : bodyStream(incoming, stopped),
    duplex: "half",
  };
  return new Request(url, init);
}

/** What {@link sendResponse} needs of Node's response. */
export interface OutgoingResponse extends NodeJS.WritableStream {
  /** The status sent. */
  statusCode: number;
  /** Set a header, replacing one of the same name. */
  setHeader(name: string, value: string | string[]): unknown;
  /** Tear the response down without finishing it. */
  destroy(): unknown;
}

/**
 * Write `response` to `outgoing`. Whatever fails is answered by tearing the
 * response down, never by a throw: a header value Node refuses, or a client
 * that stops reading. The client then sees the connection close, and the
 * server, which a throw here would have taken down, keeps serving.
 */
export async function sendResponse(
  response: Response,
  outgoing: OutgoingResponse,
): Promise<void> {
  try {
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") outgoing.setHeader(name, value);
    });
    // The one header a fetch response keeps apart; joined, it would be wrong.
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
    if (response.body === null) {
      outgoing.end();
      return;
    }
    await pipeline(Readable.fromWeb(response.body), outgoing);
  } catch {
    outgoing.destroy();
  }
}

/**
 * The server's open connections, and how many requests each is answering
 * now, so the idle ones can be closed on stop. A count, not a flag: a client
 * can send its next request before the last is answered. Kept here because not every
 * `node:http` closes idle connections on request.
 *
 * A connection is only ever marked busy or idle while it is open: a request
 * whose client went away finishes after its connection closed, and marking
 * that one would keep it here for good.
 */
export class OpenConnections {
  readonly #open = new Set<Socket>();
  readonly #answering = new WeakMap<Socket, number>();

  /** How many are open. */
  get size(): number {
    return this.#open.size;
  }

  /** `socket` has opened; it is forgotten once it closes. */
  opened(socket: Socket): void {
    if (socket.destroyed) return;
    this.#open.add(socket);
    socket.once("close", () => this.#open.delete(socket));
  }

  /** `socket` has begun answering a request. */
  busy(socket: Socket): void {
    this.#answering.set(socket, this.#count(socket) + 1);
  }

  /**
   * `socket` has answered one of its requests. Whether it is now answering
   * none.
   */
  idle(socket: Socket): boolean {
    const left = Math.max(0, this.#count(socket) - 1);
    this.#answering.set(socket, left);
    return left === 0;
  }

  /** How many requests `socket` is answering. */
  #count(socket: Socket): number {
    return this.#answering.get(socket) ?? 0;
  }

  /** Close every open connection that is not answering a request. */
  closeIdle(): void {
    for (const socket of this.#open) {
      if (this.#count(socket) === 0) socket.destroy();
    }
  }
}

/** How long a connection is drained after a body was abandoned. */
const LINGER_MS = 2_000;

/** How much of an abandoned body is drained before the connection is cut. */
const LINGER_BYTES = 16 * 1024 * 1024;

/**
 * Close `socket` after an answer to a request whose body was left unread,
 * the way a web server does: say no more, but keep taking what the client
 * is still sending for a little while. Closing outright with data still
 * arriving makes the system reset the connection, and on Windows a reset
 * can discard the answer before the client has read it. Past the time or
 * the amount, the connection is cut.
 */
export function lingerThenClose(socket: Socket): void {
  let drained = 0;
  const cut = () => socket.destroy();
  const timer = setTimeout(cut, LINGER_MS);
  socket.once("close", () => clearTimeout(timer));
  socket.on("data", (chunk: Uint8Array) => {
    drained += chunk.byteLength;
    if (drained > LINGER_BYTES) cut();
  });
  socket.end();
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
  const connections = new OpenConnections();
  const server = createServer((incoming, outgoing) => {
    const socket = incoming.socket;
    connections.busy(socket);
    outgoing.once("close", () => {
      if (connections.idle(socket) && stopping) socket.destroy();
    });
    const answer = async (): Promise<Response> => {
      try {
        // A body left unread is not a connection to keep: once this answer
        // has been written, the connection is closed, gently.
        const stopped = () => {
          outgoing.once("finish", () => lingerThenClose(socket));
        };
        return await handler(webRequest(incoming, bound, stopped));
      } catch {
        return internalError();
      }
    };
    void answer().then((response) => sendResponse(response, outgoing));
  });
  server.on("connection", (socket) => connections.opened(socket));
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
  const stop = () => {
    stopping = true;
    server.close();
    connections.closeIdle();
  };
  // An abort can land while the server was still starting, when no listener
  // was there to hear it.
  if (options.signal?.aborted) stop();
  else options.signal?.addEventListener("abort", stop, { once: true });
  try {
    options.onListen({ hostname: options.hostname, port });
  } catch (error) {
    options.signal?.removeEventListener("abort", stop);
    stop();
    await closed;
    throw error;
  }
  await closed;
}
