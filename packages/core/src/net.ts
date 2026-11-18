// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `NetTasks`: listen on a TCP port and accept connections, as byte streams,
 * on every runtime Zuke runs on. For HTTP, core has its own server; this is
 * for a protocol of a package's own, such as the engine's link to a worker.
 *
 * Built on `node:net`, which every runtime Zuke runs on implements.
 *
 * @module
 */

import { createServer, type Server, type Socket } from "node:net";

/** One accepted TCP connection. */
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
   * Listen on `hostname` and `port`; port `0` lets the system choose. Every
   * accepted connection has Nagle's algorithm off, so a short message is sent
   * at once rather than held for more.
   */
  listen(hostname: string, port: number): Promise<NetListener>;
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
      return new Promise((resolve) => socket.end(resolve));
    },
    close(): void {
      socket.destroy();
    },
  };
}

/** A listening server as a {@link NetListener}, queuing what is not yet accepted. */
function listenerOf(server: Server, port: number): NetListener {
  const arrived: Socket[] = [];
  const waiting: Array<{
    resolve: (connection: NetConnection) => void;
    reject: (error: Error) => void;
  }> = [];
  let closed = false;
  server.on("connection", (socket: Socket) => {
    const next = waiting.shift();
    if (next === undefined) arrived.push(socket);
    else next.resolve(connectionOf(socket));
  });
  const closedError = () => new Error("the listener is closed");
  return {
    port,
    accept(): Promise<NetConnection> {
      const socket = arrived.shift();
      if (socket !== undefined) return Promise.resolve(connectionOf(socket));
      if (closed) return Promise.reject(closedError());
      return new Promise((resolve, reject) =>
        waiting.push({ resolve, reject })
      );
    },
    close(): void {
      if (closed) return;
      closed = true;
      server.close();
      // A connection that arrived but was never accepted has no owner.
      for (const socket of arrived.splice(0)) socket.destroy();
      for (const next of waiting.splice(0)) next.reject(closedError());
    },
  };
}

/** TCP sockets, on whichever runtime the build runs on. */
export const NetTasks: NetTasksApi = {
  listen(hostname: string, port: number): Promise<NetListener> {
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
};
