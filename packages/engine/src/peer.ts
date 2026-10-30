// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A symmetric JSON-RPC 2.0 peer over one newline-delimited connection: both
 * sides send requests and notifications, and each answers the other's.
 *
 * @module
 */

import { INVALID_PARAMS, isRecord } from "./protocol.ts";

/** A request handler: returns the result, or throws to produce an error. */
export type RpcHandler = (params: unknown) => unknown | Promise<unknown>;

/** An error the remote side answered a request with. */
export class RpcFailure extends Error {
  /** The error name. */
  override name = "RpcFailure";
  /** Build the failure from the remote error's code and message. */
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

const encoder = new TextEncoder();

/**
 * The longest line a peer buffers, in UTF-16 units: a worker that never
 * sends a newline ends the connection rather than the engine's heap.
 */
export const MAX_LINE = 16 * 1024 * 1024;

/** The JSON-RPC peer. Call {@link serve} once to start reading. */
export class Peer {
  #conn: Deno.Conn;
  #next = 1;
  #pending = new Map<number, Pending>();
  #handlers = new Map<string, RpcHandler>();
  #writes: Promise<void> = Promise.resolve();
  #closed = false;
  /** Why the connection closed: what a request made afterwards rejects with. */
  #closeReason = "connection closed";
  #reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  #decoder = new TextDecoder();

  /** Wrap an open connection. */
  constructor(conn: Deno.Conn) {
    this.#conn = conn;
  }

  /** Whether the connection has been closed, by either side. */
  get closed(): boolean {
    return this.#closed;
  }

  /** Register the handler for `method`. */
  on(method: string, handler: RpcHandler): this {
    this.#handlers.set(method, handler);
    return this;
  }

  /** Send a request and await its result; a closed connection answers at once. */
  request(method: string, params: unknown): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(new RpcFailure(-32000, this.#closeReason));
    }
    const id = this.#next++;
    const result = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.#send({ jsonrpc: "2.0", id, method, params });
    return result;
  }

  /** Send a notification: no answer is expected. */
  notify(method: string, params: unknown): Promise<void> {
    return this.#send({ jsonrpc: "2.0", method, params });
  }

  /** Read until the connection ends, dispatching every message. */
  async serve(): Promise<void> {
    let buffered = "";
    const reader = this.#conn.readable.getReader();
    this.#reader = reader;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += this.#decoder.decode(value, { stream: true });
        let newline = buffered.indexOf("\n");
        while (newline !== -1) {
          const line = buffered.slice(0, newline).trim();
          buffered = buffered.slice(newline + 1);
          if (line !== "") this.#dispatch(line);
          newline = buffered.indexOf("\n");
        }
        if (buffered.length > MAX_LINE) {
          this.close(`a message longer than ${MAX_LINE} characters`);
          break;
        }
      }
    } catch (error) {
      // A read after close() is the close. A read error otherwise is the
      // remote vanishing: Windows reports a peer that died as a reset, not
      // an end of stream, and either way nothing is left to read.
      if (!this.#closed) {
        this.close(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.close();
    }
  }

  /** Close the connection; every pending request rejects with `reason`. */
  close(reason = "connection closed"): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeReason = reason;
    // Deno holds a socket's close back while a read is pending on it, so the
    // other side would never see the end: shut the write half first, which
    // sends it at once, and release the socket once that is done. Cancelling
    // the reader is what ends serve().
    const conn = this.#conn;
    conn.closeWrite().catch(() => {}).finally(() => {
      try {
        conn.close();
      } catch {
        // Already closed by the other side: nothing left to release.
      }
    });
    void this.#reader?.cancel().catch(() => {});
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      pending.reject(new RpcFailure(-32000, reason));
    }
  }

  #dispatch(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return; // Not JSON: a worker that spoke on the wrong channel. Ignore it.
    }
    if (!isRecord(message)) return;
    const { id, method } = message;
    if (typeof method === "string") {
      void this.#handle(method, message.params, id);
    } else if (typeof id === "number") {
      const pending = this.#pending.get(id);
      if (pending === undefined) return;
      this.#pending.delete(id);
      const error = message.error;
      if (isRecord(error)) {
        pending.reject(
          new RpcFailure(
            typeof error.code === "number" ? error.code : -32000,
            typeof error.message === "string" ? error.message : "error",
          ),
        );
      } else {
        pending.resolve(message.result);
      }
    }
  }

  async #handle(method: string, params: unknown, id: unknown): Promise<void> {
    const handler = this.#handlers.get(method);
    const answer = typeof id === "number";
    if (handler === undefined) {
      if (answer) {
        await this.#send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `unknown method "${method}"` },
        });
      }
      return;
    }
    try {
      const result = await handler(params);
      if (answer) {
        // A handler with nothing to say answers `{}`; `null` is an answer.
        await this.#send({
          jsonrpc: "2.0",
          id,
          result: result === undefined ? {} : result,
        });
      }
    } catch (error) {
      if (!answer) return;
      const code = error instanceof RpcFailure ? error.code : INVALID_PARAMS;
      const message = error instanceof Error ? error.message : String(error);
      await this.#send({ jsonrpc: "2.0", id, error: { code, message } });
    }
  }

  #send(message: Record<string, unknown>): Promise<void> {
    const bytes = encoder.encode(JSON.stringify(message) + "\n");
    // Serialise writes: a partial write from one message must never interleave
    // with another's bytes.
    this.#writes = this.#writes.then(async () => {
      if (this.#closed) return;
      let written = 0;
      while (written < bytes.length) {
        written += await this.#conn.write(bytes.subarray(written));
      }
    }).catch(() => this.close());
    return this.#writes;
  }
}
