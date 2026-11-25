// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `NetTasks`: listen on a TCP port and accept connections, or connect to one,
 * as byte streams, on every runtime Zuke runs on, and serve HTTP with a
 * web-style handler.
 *
 * Built on `node:net`, which every runtime Zuke runs on implements.
 *
 * @module
 */

import { connect, createServer, type Server, type Socket } from "node:net";
import { type FetchHandler, serve } from "./serve.ts";
import type { Configure } from "./tooling.ts";

/** Where {@link NetTasks.listen} listens. */
export class ListenSettings {
  /** The address to listen on; see {@link hostname}. */
  hostname_ = "127.0.0.1";

  /** The port to listen on; see {@link port}. */
  port_ = 0;

  /**
   * The address to listen on (default `127.0.0.1`, reachable only from this
   * machine). `0.0.0.0` accepts connections from anywhere the network allows.
   */
  hostname(address: string): this {
    this.hostname_ = address;
    return this;
  }

  /** The port to listen on (default `0`, which lets the system choose). */
  port(number: number): this {
    this.port_ = number;
    return this;
  }
}

export type { FetchHandler } from "./serve.ts";

/** Where {@link NetTasks.connect} connects. */
export class ConnectSettings {
  /** The address to connect to; see {@link hostname}. */
  hostname_ = "127.0.0.1";

  /** The address to connect to (default `127.0.0.1`, this machine). */
  hostname(address: string): this {
    this.hostname_ = address;
    return this;
  }
}

/** An HTTP server {@link NetTasks.serve} started. */
export interface NetServer {
  /** The port, which the system chose when `0` was asked for. */
  readonly port: number;
  /** Stop serving, resolving once the server has closed. */
  close(): Promise<void>;
}

/** One TCP connection, accepted or opened. */
export interface NetConnection {
  /**
   * What the other side sends. It ends when the other side closes its half,
   * and errors when the connection is reset.
   */
  readonly readable: ReadableStream<Uint8Array>;
  /** Send `bytes`, resolving once they are handed to the operating system. */
  write(bytes: Uint8Array): Promise<void>;
  /** Close this side's half: the other side reads an end, and may still send. */
  closeWrite(): Promise<void>;
  /** Close the connection in both directions, at once. */
  close(): void;
}

/** A TCP port being listened on. */
export interface NetListener {
  /** The port, which the system chose when `0` was asked for. */
  readonly port: number;
  /**
   * The next connection, as it arrives.
   *
   * @throws once the listener is closed.
   */
  accept(): Promise<NetConnection>;
  /** Stop listening. Connections already accepted stay open. */
  close(): void;
}

/** The shape of {@link NetTasks}. */
export interface NetTasksApi {
  /**
   * Listen as `configure` says: on loopback, on a port the system chooses,
   * unless set otherwise. Every accepted connection sends a
   * short message at once rather than holding it for more.
   *
   * ```ts
   * const listener = await NetTasks.listen((s) => s.port(8080));
   * ```
   */
  listen(configure?: Configure<ListenSettings>): Promise<NetListener>;

  /**
   * Connect to `port`, on loopback unless `configure` names another host.
   *
   * ```ts
   * const connection = await NetTasks.connect(8080);
   * ```
   *
   * @throws when nothing accepts the connection.
   */
  connect(
    port: number,
    configure?: Configure<ConnectSettings>,
  ): Promise<NetConnection>;

  /**
   * Answer HTTP requests with `handler`, listening where `configure` says, as
   * {@link listen} does, until the server is closed.
   *
   * ```ts
   * const server = await NetTasks.serve(() => new Response("ok"));
   * await fetch(`http://127.0.0.1:${server.port}/`);
   * await server.close();
   * ```
   */
  serve(
    handler: FetchHandler,
    configure?: Configure<ListenSettings>,
  ): Promise<NetServer>;
}

/**
 * A socket's incoming bytes as a stream, pausing the socket while the stream is
 * full. It ends when the socket ends or is closed by either side, and errors
 * when the socket does, whichever comes first.
 */
function readableOf(socket: Socket): ReadableStream<Uint8Array> {
  let settled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      socket.on("data", (chunk: Uint8Array) => {
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 0) <= 0) socket.pause();
      });
      const end = () => {
        if (settled) return;
        settled = true;
        controller.close();
      };
      socket.once("end", end);
      socket.once("close", end);
      // `on`, not `once`: a write after a reset errors the socket again, and
      // an error with no listener would end the process.
      socket.on("error", (error) => {
        if (settled) return;
        settled = true;
        controller.error(error);
      });
    },
    pull() {
      socket.resume();
    },
    cancel() {
      settled = true;
      socket.destroy();
    },
  });
}

/** An accepted socket as a {@link NetConnection}. */
function connectionOf(socket: Socket): NetConnection {
  socket.setNoDelay(true);
  return {
    readable: readableOf(socket),
    write(bytes: Uint8Array): Promise<void> {
      return new Promise((resolve, reject) => {
        socket.write(bytes, (error) => error ? reject(error) : resolve());
      });
    },
    closeWrite(): Promise<void> {
      // A socket already closed, by `close` or a cancelled read, never
      // finishes an end, so there is nothing to wait for.
      if (socket.destroyed) return Promise.resolve();
      return new Promise((resolve) => {
        socket.once("close", () => resolve());
        socket.end(() => resolve());
      });
    },
    close(): void {
      socket.destroy();
    },
  };
}

/**
 * A listening server as a {@link NetListener}, queuing what is not yet
 * accepted. Module-internal, exported for its tests.
 */
export function listenerOf(server: Server, port: number): NetListener {
  // Wrapped on arrival, so a queued connection has its error listener before
  // anything can go wrong with it: a reset before `accept` must not end the
  // process, and the reader still learns of it.
  const arrived: NetConnection[] = [];
  const waiting: Array<{
    resolve: (connection: NetConnection) => void;
    reject: (error: Error) => void;
  }> = [];
  // Why the listener stopped, once it has: what every later accept rejects with.
  let ended: Error | null = null;
  const end = (reason: Error): void => {
    if (ended !== null) return;
    ended = reason;
    server.close();
    // A connection that arrived but was never accepted has no owner.
    for (const connection of arrived.splice(0)) connection.close();
    for (const next of waiting.splice(0)) next.reject(reason);
  };
  server.on("connection", (socket: Socket) => {
    const next = waiting.shift();
    const connection = connectionOf(socket);
    if (next === undefined) arrived.push(connection);
    else next.resolve(connection);
  });
  // A server that fails after binding, such as on an accept the system
  // refuses, ends the listener: with no listener the error would end the
  // process instead.
  server.on("error", end);
  return {
    port,
    accept(): Promise<NetConnection> {
      const connection = arrived.shift();
      if (connection !== undefined) return Promise.resolve(connection);
      if (ended !== null) return Promise.reject(ended);
      return new Promise((resolve, reject) =>
        waiting.push({ resolve, reject })
      );
    },
    close(): void {
      end(new Error("the listener is closed"));
    },
  };
}

/** TCP sockets, on whichever runtime the build runs on. */
export const NetTasks: NetTasksApi = {
  listen(
    configure: Configure<ListenSettings> = (s) => s,
  ): Promise<NetListener> {
    const { hostname_: hostname, port_: port } = configure(
      new ListenSettings(),
    );
    // Half-open, so the other side closing its half leaves this side's open
    // for an answer, as `closeWrite` promises the other side.
    const server = createServer({ allowHalfOpen: true });
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, hostname, () => {
        server.off("error", reject);
        const address = server.address();
        // Bound to a host and port, the address is never a pipe's name.
        const bound = typeof address === "object" && address !== null
          ? address.port
          : port;
        resolve(listenerOf(server, bound));
      });
    });
  },

  connect(
    port: number,
    configure: Configure<ConnectSettings> = (s) => s,
  ): Promise<NetConnection> {
    const { hostname_: hostname } = configure(new ConnectSettings());
    // Half-open, as an accepted connection is, for `closeWrite`'s promise.
    const socket = connect({ host: hostname, port, allowHalfOpen: true });
    return new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.off("error", reject);
        resolve(connectionOf(socket));
      });
    });
  },

  serve(
    handler: FetchHandler,
    configure: Configure<ListenSettings> = (s) => s,
  ): Promise<NetServer> {
    const { hostname_: hostname, port_: port } = configure(
      new ListenSettings(),
    );
    const stop = new AbortController();
    return new Promise((resolve, reject) => {
      const served = serve({
        hostname,
        port,
        signal: stop.signal,
        onListen: (address) =>
          resolve({
            port: address.port,
            close: () => {
              stop.abort();
              return served;
            },
          }),
      }, handler);
      // Failing to start rejects; once started, closing is what ends it.
      served.catch(reject);
    });
  },
};
